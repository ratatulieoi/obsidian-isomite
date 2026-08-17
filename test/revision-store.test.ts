import { describe, expect, it } from "vitest";
import { deriveKeys, generateSaltBase64 } from "../src/crypto/crypto";
import { R2Client, R2Transport } from "../src/r2/r2-client";
import { RevisionStore, RemoteHeadChangedError } from "../src/sync/revision-store";
import { REMOTE_REVISION_FORMAT, RemoteRevision } from "../src/sync/types";

const credentials = {
	endpoint: "https://abc123.r2.cloudflarestorage.com",
	bucket: "vault",
	accessKeyId: "access-key",
	secretAccessKey: "secret-key",
};

interface StoredObject {
	body: Uint8Array;
	etag: string;
}

function memoryTransport(): {
	objects: Map<string, StoredObject>;
	requests: Array<{ url: string; init: Parameters<R2Transport>[1] }>;
	transport: R2Transport;
} {
	const objects = new Map<string, StoredObject>();
	const requests: Array<{ url: string; init: Parameters<R2Transport>[1] }> = [];
	let etagSequence = 0;
	const transport: R2Transport = async (url, init) => {
		requests.push({ url, init });
		const key = decodeURIComponent(new URL(url).pathname.replace(/^\/vault\/?/, ""));
		const existing = objects.get(key);
		if (init.method === "GET") {
			if (!existing) return response(404);
			return response(200, existing.body, { etag: `"${existing.etag}"` });
		}
		if (init.method === "PUT") {
			if (init.headers["if-none-match"] === "*" && existing) return response(412);
			if (init.headers["if-match"] && init.headers["if-match"] !== existing?.etag) return response(412);
			const stored = { body: init.body ?? new Uint8Array(), etag: `etag-${++etagSequence}` };
			objects.set(key, stored);
			return response(200, new Uint8Array(), { etag: `"${stored.etag}"` });
		}
		return response(405);
	};
	return { objects, requests, transport };
}

function response(status: number, body: Uint8Array = new Uint8Array(), headers: Record<string, string> = {}) {
	return { status, body, headers, text: new TextDecoder().decode(body) };
}

function revision(id: string, parentRevisionId: string | null, generation: number, contentHash: string): RemoteRevision {
	return {
		format: REMOTE_REVISION_FORMAT,
		vaultId: "vault-12345678",
		revisionId: id,
		parentRevisionId,
		generation,
		createdAt: "2026-08-01T12:00:00.000Z",
		deviceId: "device-12345678",
		files: [{ path: "Note.md", contentHash, size: 4 }],
		ignorePatterns: [],
	};
}

describe("RevisionStore", () => {
	it("deduplicates encrypted blobs and verifies downloads", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const memory = memoryTransport();
		const store = new RevisionStore(new R2Client(credentials, memory.transport), keys);
		const bytes = new TextEncoder().encode("note");

		const first = await store.putBlob(bytes);
		const second = await store.putBlob(bytes);

		expect(first.uploaded).toBe(true);
		expect(second.uploaded).toBe(false);
		expect(new TextDecoder().decode(await store.getBlob(first.contentHash))).toBe("note");
	});

	it("commits a first revision and reads it through the encrypted head", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const memory = memoryTransport();
		const store = new RevisionStore(new R2Client(credentials, memory.transport), keys);
		const blob = await store.putBlob(new TextEncoder().encode("note"));
		const first = revision("revision-11111111", null, 1, blob.contentHash);

		const committed = await store.commitRevision(first);

		expect(committed.head.revisionId).toBe(first.revisionId);
		expect((await store.readHead())?.head).toEqual(committed.head);
		const headPut = [...memory.requests].reverse().find((request) =>
			request.init.method === "PUT" && new URL(request.url).pathname.endsWith("/_isomite/head-v1")
		);
		expect(headPut?.init.headers["cache-control"]).toBe("no-store");
		expect(await store.readRevision(first.revisionId)).toEqual(first);
	});

	it("rejects a stale concurrent head update", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const memory = memoryTransport();
		const store = new RevisionStore(new R2Client(credentials, memory.transport), keys);
		const blob = await store.putBlob(new TextEncoder().encode("note"));
		const first = await store.commitRevision(revision("revision-11111111", null, 1, blob.contentHash));
		const stale = { head: first.head, etag: "stale-etag" };

		await expect(
			store.commitRevision(revision("revision-22222222", first.head.revisionId, 2, blob.contentHash), stale)
		).rejects.toBeInstanceOf(RemoteHeadChangedError);
		expect((await store.readHead())?.head.revisionId).toBe(first.head.revisionId);
	});
});
