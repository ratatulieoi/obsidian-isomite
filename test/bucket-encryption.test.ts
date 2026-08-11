import { describe, expect, it } from "vitest";
import { initializeOrVerifyEncryption, PassphraseMismatchError } from "../src/crypto/bucket-encryption";
import { R2Client, R2Transport, R2TransportResponse } from "../src/r2/r2-client";

const credentials = {
	endpoint: "https://abc123.r2.cloudflarestorage.com",
	bucket: "vault",
	accessKeyId: "access-key",
	secretAccessKey: "secret-key",
};

class MemoryR2 {
	private objects = new Map<string, { body: Uint8Array; etag: string }>();
	private nextEtag = 1;

	readonly transport: R2Transport = async (url, init) => {
		const key = decodeURIComponent(new URL(url).pathname.replace(/^\/vault\//, ""));
		const existing = this.objects.get(key);

		if (init.method === "GET") {
			if (new URL(url).searchParams.get("list-type") === "2") {
				const contents = [...this.objects.entries()].map(([objectKey, object]) =>
					`<Contents><Key>${objectKey}</Key><LastModified>2026-08-01T00:00:00.000Z</LastModified><ETag>"${object.etag}"</ETag><Size>${object.body.byteLength}</Size></Contents>`
				).join("");
				return makeResponse(200, `<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
			}
			if (!existing) return makeResponse(404, "<Error><Code>NoSuchKey</Code></Error>");
			return makeResponse(200, new TextDecoder().decode(existing.body), { etag: `"${existing.etag}"` });
		}

		if (init.method === "PUT") {
			if (init.headers["if-none-match"] === "*" && existing) return makeResponse(412);
			if (init.headers["if-match"] && init.headers["if-match"] !== existing?.etag) return makeResponse(412);
			const etag = String(this.nextEtag++);
			this.objects.set(key, { body: init.body?.slice() ?? new Uint8Array(), etag });
			return makeResponse(200, "", { etag: `"${etag}"` });
		}

		return makeResponse(405);
	};

	keys(): string[] {
		return [...this.objects.keys()];
	}
}

describe("bucket encryption metadata", () => {
	it("initializes one Isomite metadata object and verifies the same passphrase", async () => {
		const bucket = new MemoryR2();
		const client = new R2Client(credentials, bucket.transport);

		await initializeOrVerifyEncryption(client, "correct passphrase");
		await expect(initializeOrVerifyEncryption(client, "correct passphrase")).resolves.toBeDefined();
		expect(bucket.keys()).toEqual(["_isomite/encryption-v1.json"]);
	});

	it("refuses to initialize encryption in a non-empty bucket", async () => {
		const bucket = new MemoryR2();
		const client = new R2Client(credentials, bucket.transport);
		await client.putObject("unrelated.txt", new TextEncoder().encode("data"));

		await expect(initializeOrVerifyEncryption(client, "correct passphrase")).rejects.toThrow("dedicated empty bucket");
		expect(bucket.keys()).toEqual(["unrelated.txt"]);
	});

	it("rejects the wrong passphrase without creating another object", async () => {
		const bucket = new MemoryR2();
		const client = new R2Client(credentials, bucket.transport);
		await initializeOrVerifyEncryption(client, "correct passphrase");

		await expect(initializeOrVerifyEncryption(client, "wrong passphrase")).rejects.toThrow(
			PassphraseMismatchError
		);
		expect(bucket.keys()).toEqual(["_isomite/encryption-v1.json"]);
	});
});

function makeResponse(
	status: number,
	text = "",
	headers: Record<string, string> = {}
): R2TransportResponse {
	return {
		status,
		headers,
		body: new TextEncoder().encode(text),
		text,
	};
}
