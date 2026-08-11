import { asBufferSource } from "../util/bytes";

export interface R2Credentials {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export interface R2TransportResponse {
	status: number;
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

/**
 * Small Cloudflare R2 client that signs path-style S3 REST requests with AWS
 * Signature Version 4. It intentionally uses WebCrypto instead of the AWS
 * SDK so the same code can run in Obsidian's desktop and mobile sandboxes.
 */
export class R2Client {
	constructor(
		private readonly credentials: R2Credentials,
		private readonly transport: R2Transport
	) {}

	async testConnection(): Promise<R2ConnectionResult> {
		const xml = await this.listFirstPage();
		return { objectCount: countListedObjects(xml) };
	}

	private async listFirstPage(): Promise<string> {
		const response = await this.signedRequest({
			method: "GET",
			key: "",
			query: { "list-type": "2", "max-keys": "1" },
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(formatR2Error("LIST", response.status, response.text));
		}
		return response.text;
	}

	private async signedRequest(request: {
		method: string;
		key: string;
		query?: Record<string, string>;
		body?: Uint8Array;
	}): Promise<R2TransportResponse> {
		const credentials = validateCredentials(this.credentials);
		const endpoint = new URL(credentials.endpoint);
		const { amzDate, dateStamp } = createAmzDate(new Date());
		const body = request.body ?? new Uint8Array();
		const bodyHash = await sha256Hex(body);
		const canonicalUri = `/${encodePathSegment(credentials.bucket)}/${encodeObjectKey(request.key)}`;
		const canonicalQuery = canonicalizeQuery(request.query ?? {});

		const canonicalHeaders =
			`host:${endpoint.host}\n` +
			`x-amz-content-sha256:${bodyHash}\n` +
			`x-amz-date:${amzDate}\n`;
		const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
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

		return this.transport(url, {
			method: request.method,
			headers: {
				"x-amz-content-sha256": bodyHash,
				"x-amz-date": amzDate,
				authorization,
			},
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
	return xml.match(/<Contents>/g)?.length ?? 0;
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
