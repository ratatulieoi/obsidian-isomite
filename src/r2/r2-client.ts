import { asBufferSource } from "../util/bytes";

export interface R2Credentials {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export interface R2TransportResponse {
	status: number;
	headers: Record<string, string>;
	body: Uint8Array;
	text: string;
}

export type R2Transport = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body?: Uint8Array;
	}
) => Promise<R2TransportResponse>;

export interface R2ConnectionResult {
	objectCount: number;
}

export interface R2GetResult {
	body: Uint8Array;
	etag: string;
}

export interface R2ListedObject {
	key: string;
	etag: string;
	size: number;
	lastModified: string;
}

export interface R2ListResult {
	objects: R2ListedObject[];
	isTruncated: boolean;
	nextContinuationToken?: string;
}

export interface R2PutOptions {
	contentType?: string;
	cacheControl?: string;
	ifMatch?: string;
	ifNoneMatch?: "*";
}

export interface R2PutResult {
	etag: string;
}

export class R2NotFoundError extends Error {
	constructor(key: string) {
		super(`R2 object not found: ${key}`);
		this.name = "R2NotFoundError";
	}
}

export class R2PreconditionFailedError extends Error {
	constructor() {
		super("R2 object changed before the conditional request completed.");
		this.name = "R2PreconditionFailedError";
	}
}

/**
 * Small Cloudflare R2 client that signs path-style S3 REST requests with AWS
 * Signature Version 4. It uses WebCrypto rather than the AWS SDK so the same
 * implementation works in Obsidian on desktop and mobile.
 */
export class R2Client {
	constructor(
		private readonly credentials: R2Credentials,
		private readonly transport: R2Transport
	) {}

	async testConnection(): Promise<R2ConnectionResult> {
		const response = await this.signedRequest({
			method: "GET",
			key: "",
			query: { "list-type": "2", "max-keys": "1" },
		});
		assertSuccess("LIST", response);
		return { objectCount: countListedObjects(response.text) };
	}

	async listObjects(prefix = "", continuationToken?: string): Promise<R2ListResult> {
		const query: Record<string, string> = { "list-type": "2", prefix };
		if (continuationToken) query["continuation-token"] = continuationToken;
		const response = await this.signedRequest({ method: "GET", key: "", query });
		assertSuccess("LIST", response);
		return parseListObjects(response.text);
	}

	async getObject(key: string): Promise<R2GetResult> {
		// The current-head object is overwritten in place. Explicit no-cache
		// request headers prevent Obsidian, a platform HTTP cache, or an
		// intermediary from returning an older successful GET after a commit.
		const response = await this.signedRequest({
			method: "GET",
			key,
			headers: { "cache-control": "no-cache, no-store", pragma: "no-cache" },
		});
		if (response.status === 404) throw new R2NotFoundError(key);
		assertSuccess(`GET ${key}`, response);
		return {
			body: response.body,
			etag: normalizeEtag(getHeader(response.headers, "etag")),
		};
	}

	async putObject(key: string, body: Uint8Array, options: R2PutOptions = {}): Promise<R2PutResult> {
		const headers: Record<string, string> = {};
		if (options.contentType) headers["content-type"] = options.contentType;
		if (options.cacheControl) headers["cache-control"] = options.cacheControl;
		if (options.ifMatch) headers["if-match"] = options.ifMatch;
		if (options.ifNoneMatch) headers["if-none-match"] = options.ifNoneMatch;

		const response = await this.signedRequest({ method: "PUT", key, headers, body });
		if (response.status === 412) throw new R2PreconditionFailedError();
		assertSuccess(`PUT ${key}`, response);
		return { etag: normalizeEtag(getHeader(response.headers, "etag")) };
	}

	async deleteObject(key: string, ifMatch?: string): Promise<void> {
		const headers: Record<string, string> = {};
		if (ifMatch) headers["if-match"] = ifMatch;
		const response = await this.signedRequest({ method: "DELETE", key, headers });
		if (response.status === 404) return;
		if (response.status === 412) throw new R2PreconditionFailedError();
		assertSuccess(`DELETE ${key}`, response);
	}

	private async signedRequest(request: {
		method: string;
		key: string;
		query?: Record<string, string>;
		headers?: Record<string, string>;
		body?: Uint8Array;
	}): Promise<R2TransportResponse> {
		const credentials = validateCredentials(this.credentials);
		const endpoint = new URL(credentials.endpoint);
		const { amzDate, dateStamp } = createAmzDate(new Date());
		const body = request.body ?? new Uint8Array();
		const bodyHash = await sha256Hex(body);
		const canonicalUri = `/${encodePathSegment(credentials.bucket)}/${encodeObjectKey(request.key)}`;
		const canonicalQuery = canonicalizeQuery(request.query ?? {});

		const headers = normalizeHeaders({
			host: endpoint.host,
			"x-amz-content-sha256": bodyHash,
			"x-amz-date": amzDate,
			...(request.headers ?? {}),
		});
		const signedHeaderNames = Object.keys(headers).sort();
		const canonicalHeaders = signedHeaderNames
			.map((name) => `${name}:${normalizeHeaderValue(headers[name])}\n`)
			.join("");
		const signedHeaders = signedHeaderNames.join(";");
		const canonicalRequest = [
			request.method,
			canonicalUri,
			canonicalQuery,
			canonicalHeaders,
			signedHeaders,
			bodyHash,
		].join("\n");

		const scope = `${dateStamp}/auto/s3/aws4_request`;
		const stringToSign = [
			"AWS4-HMAC-SHA256",
			amzDate,
			scope,
			await sha256Hex(new TextEncoder().encode(canonicalRequest)),
		].join("\n");
		const signingKey = await deriveSigningKey(credentials.secretAccessKey, dateStamp);
		const signature = hex(await hmacSha256(signingKey, stringToSign));
		const authorization =
			`AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
			`SignedHeaders=${signedHeaders}, Signature=${signature}`;
		const url = `${endpoint.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`;

		const transportHeaders: Record<string, string> = { ...headers, authorization };
		delete transportHeaders.host;
		return this.transport(url, {
			method: request.method,
			headers: transportHeaders,
			body: request.body,
		});
	}
}

function validateCredentials(credentials: R2Credentials): R2Credentials {
	if (!credentials.endpoint) throw new Error("Enter the R2 S3 API endpoint.");
	if (!credentials.bucket) throw new Error("Enter the R2 bucket name.");
	if (!credentials.accessKeyId) throw new Error("Enter the R2 Access Key ID.");
	if (!credentials.secretAccessKey) throw new Error("Enter the R2 Secret Access Key.");

	let endpoint: URL;
	try {
		endpoint = new URL(credentials.endpoint);
	} catch {
		throw new Error("The R2 endpoint is not a valid URL.");
	}
	if (endpoint.protocol !== "https:") throw new Error("The R2 endpoint must use HTTPS.");
	if (endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
		throw new Error("The R2 endpoint must not include a path, query, or fragment.");
	}

	return { ...credentials, endpoint: endpoint.origin };
}

function createAmzDate(date: Date): { amzDate: string; dateStamp: string } {
	const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
	return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function awsEncode(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
		`%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

function encodePathSegment(value: string): string {
	return awsEncode(value);
}

function encodeObjectKey(key: string): string {
	return key.split("/").map(awsEncode).join("/");
}

function canonicalizeQuery(query: Record<string, string>): string {
	return Object.entries(query)
		.map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
		.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
			leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
		)
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) normalized[name.toLowerCase()] = value;
	return normalized;
}

function normalizeHeaderValue(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	return hex(await crypto.subtle.digest("SHA-256", asBufferSource(bytes)));
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
	const bytes = key instanceof Uint8Array ? key : new Uint8Array(key);
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		asBufferSource(bytes),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	return crypto.subtle.sign("HMAC", cryptoKey, asBufferSource(new TextEncoder().encode(message)));
}

async function deriveSigningKey(secretAccessKey: string, dateStamp: string): Promise<ArrayBuffer> {
	const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
	const kRegion = await hmacSha256(kDate, "auto");
	const kService = await hmacSha256(kRegion, "s3");
	return hmacSha256(kService, "aws4_request");
}

function hex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function countListedObjects(xml: string): number {
	const keyCount = Number(extractXml(xml, "KeyCount"));
	return Number.isFinite(keyCount) && keyCount >= 0 ? keyCount : (xml.match(/<Contents>/g)?.length ?? 0);
}

function parseListObjects(xml: string): R2ListResult {
	const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
		const content = match[1];
		const key = decodeXml(extractXml(content, "Key"));
		const size = Number(extractXml(content, "Size"));
		if (!key || !Number.isSafeInteger(size) || size < 0) throw new Error("R2 returned invalid object metadata.");
		return {
			key,
			etag: normalizeEtag(decodeXml(extractXml(content, "ETag"))),
			size,
			lastModified: decodeXml(extractXml(content, "LastModified")),
		};
	});
	const isTruncated = extractXml(xml, "IsTruncated").trim().toLowerCase() === "true";
	const nextContinuationToken = decodeXml(extractXml(xml, "NextContinuationToken")) || undefined;
	if (isTruncated && !nextContinuationToken) throw new Error("R2 truncated an object listing without a continuation token.");
	return { objects, isTruncated, nextContinuationToken };
}

function assertSuccess(operation: string, response: R2TransportResponse): void {
	if (response.status >= 200 && response.status < 300) return;
	throw new Error(formatR2Error(operation, response.status, response.text));
}

function formatR2Error(operation: string, status: number, body: string): string {
	const code = decodeXml(extractXml(body, "Code"));
	const message = decodeXml(extractXml(body, "Message"));
	const details = [code, message].filter(Boolean).join(": ");
	return `${operation} failed with HTTP ${status}${details ? ` (${details})` : ""}`;
}

function extractXml(xml: string, element: string): string {
	const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return xml.match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`))?.[1] ?? "";
}

function decodeXml(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function getHeader(headers: Record<string, string>, requestedName: string): string {
	const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === requestedName.toLowerCase());
	return entry?.[1] ?? "";
}

function normalizeEtag(value: string): string {
	return value.replace(/&quot;/g, "").replace(/"/g, "");
}
