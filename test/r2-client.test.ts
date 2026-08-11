import { describe, expect, it } from "vitest";
import { R2Client, R2Transport } from "../src/r2/r2-client";

const credentials = {
	endpoint: "https://abc123.r2.cloudflarestorage.com",
	bucket: "my vault",
	accessKeyId: "access-key",
	secretAccessKey: "secret-key",
};

describe("R2Client", () => {
	it("uses a signed, read-only ListObjectsV2 request for connection tests", async () => {
		let capturedUrl = "";
		let capturedInit: Parameters<R2Transport>[1] | undefined;
		const transport: R2Transport = async (url, init) => {
			capturedUrl = url;
			capturedInit = init;
			return {
				status: 200,
				text: "<ListBucketResult><Contents></Contents></ListBucketResult>",
			};
		};

		const result = await new R2Client(credentials, transport).testConnection();

		expect(result.objectCount).toBe(1);
		expect(capturedUrl).toContain("/my%20vault/?list-type=2&max-keys=1");
		expect(capturedInit?.method).toBe("GET");
		expect(capturedInit?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=access-key\//);
		expect(capturedInit?.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect(capturedInit?.body).toBeUndefined();
	});

	it("surfaces Cloudflare's XML error code and message", async () => {
		const transport: R2Transport = async () => ({
			status: 403,
			text: "<Error><Code>AccessDenied</Code><Message>Access denied</Message></Error>",
		});

		await expect(new R2Client(credentials, transport).testConnection()).rejects.toThrow(
			"LIST failed with HTTP 403 (AccessDenied: Access denied)"
		);
	});

	it("validates all required connection fields before making a request", async () => {
		let called = false;
		const transport: R2Transport = async () => {
			called = true;
			return { status: 200, text: "" };
		};

		await expect(new R2Client({ ...credentials, bucket: "" }, transport).testConnection()).rejects.toThrow(
			"Enter the R2 bucket name."
		);
		expect(called).toBe(false);
	});
});
