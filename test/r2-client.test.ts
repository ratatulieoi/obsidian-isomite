import { describe, expect, it } from "vitest";
import { R2Client, R2Transport } from "../src/r2/r2-client";

const credentials = {
	endpoint: "https://abc123.r2.cloudflarestorage.com",
	bucket: "my vault",
	accessKeyId: "access-key",
	secretAccessKey: "secret-key",
};

function response(status: number, text = "", headers: Record<string, string> = {}): Awaited<ReturnType<R2Transport>> {
	return {
		status,
		headers,
		body: new TextEncoder().encode(text),
		text,
	};
}

describe("R2Client", () => {
	it("uses a signed, read-only ListObjectsV2 request for connection tests", async () => {
		let capturedUrl = "";
		let capturedInit: Parameters<R2Transport>[1] | undefined;
		const transport: R2Transport = async (url, init) => {
			capturedUrl = url;
			capturedInit = init;
			return response(200, "<ListBucketResult><KeyCount>1</KeyCount><Contents></Contents></ListBucketResult>");
		};

		const result = await new R2Client(credentials, transport).testConnection();

		expect(result.objectCount).toBe(1);
		expect(capturedUrl).toContain("/my%20vault/?list-type=2&max-keys=1");
		expect(capturedInit?.method).toBe("GET");
		expect(capturedInit?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=access-key\//);
		expect(capturedInit?.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect(capturedInit?.body).toBeUndefined();
	});

	it("bypasses caches when reading mutable R2 objects", async () => {
		let capturedInit: Parameters<R2Transport>[1] | undefined;
		const transport: R2Transport = async (_url, init) => {
			capturedInit = init;
			return response(200, "object", { etag: '"etag-1"' });
		};

		await new R2Client(credentials, transport).getObject("_isomite/head-v1");

		expect(capturedInit?.headers["cache-control"]).toBe("no-cache, no-store");
		expect(capturedInit?.headers.pragma).toBe("no-cache");
		expect(capturedInit?.headers.authorization).toContain(
			"SignedHeaders=cache-control;host;pragma;x-amz-content-sha256;x-amz-date"
		);
	});

	it("surfaces Cloudflare's XML error code and message", async () => {
		const transport: R2Transport = async () =>
			response(403, "<Error><Code>AccessDenied</Code><Message>Access denied</Message></Error>");

		await expect(new R2Client(credentials, transport).testConnection()).rejects.toThrow(
			"LIST failed with HTTP 403 (AccessDenied: Access denied)"
		);
	});

	it("validates all required connection fields before making a request", async () => {
		let called = false;
		const transport: R2Transport = async () => {
			called = true;
			return response(200);
		};

		await expect(new R2Client({ ...credentials, bucket: "" }, transport).testConnection()).rejects.toThrow(
			"Enter the R2 bucket name."
		);
		expect(called).toBe(false);
	});

	it("lists object metadata and continuation state", async () => {
		const transport: R2Transport = async () =>
			response(
				200,
				"<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken>" +
					'<Contents><Key>_isomite%2Fignored</Key><LastModified>2026-08-01T00:00:00.000Z</LastModified><ETag>"etag-1"</ETag><Size>42</Size></Contents>' +
					"</ListBucketResult>"
			);

		const result = await new R2Client(credentials, transport).listObjects("_isomite/");

		expect(result).toEqual({
			objects: [
				{
					key: "_isomite%2Fignored",
					etag: "etag-1",
					size: 42,
					lastModified: "2026-08-01T00:00:00.000Z",
				},
			],
			isTruncated: true,
			nextContinuationToken: "next&token",
		});
	});

	it("signs conditional object writes and returns a normalized ETag", async () => {
		let capturedInit: Parameters<R2Transport>[1] | undefined;
		const transport: R2Transport = async (_url, init) => {
			capturedInit = init;
			return response(200, "", { etag: '"abc123"' });
		};

		const result = await new R2Client(credentials, transport).putObject("_isomite/meta.json", new Uint8Array([1]), {
			contentType: "application/json",
			ifNoneMatch: "*",
		});

		expect(result.etag).toBe("abc123");
		expect(capturedInit?.headers["content-type"]).toBe("application/json");
		expect(capturedInit?.headers["if-none-match"]).toBe("*");
		expect(capturedInit?.headers.authorization).toContain(
			"SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date"
		);
	});

	it("signs conditional deletes", async () => {
		let capturedInit: Parameters<R2Transport>[1] | undefined;
		const transport: R2Transport = async (_url, init) => {
			capturedInit = init;
			return response(204);
		};

		await new R2Client(credentials, transport).deleteObject("_isomite/old", "etag-1");

		expect(capturedInit?.method).toBe("DELETE");
		expect(capturedInit?.headers["if-match"]).toBe("etag-1");
	});
});
