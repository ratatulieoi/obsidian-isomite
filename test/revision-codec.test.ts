import { describe, expect, it } from "vitest";
import { deriveKeys, generateSaltBase64 } from "../src/crypto/crypto";
import {
	decodeRemoteHead,
	decodeRemoteRevision,
	encodeRemoteHead,
	encodeRemoteRevision,
	remoteBlobObjectKey,
	remoteHeadObjectKey,
	remoteRevisionObjectKey,
} from "../src/sync/revision-codec";
import { REMOTE_HEAD_FORMAT, REMOTE_REVISION_FORMAT, RemoteHead, RemoteRevision } from "../src/sync/types";

const HASH = "ab".repeat(32);

function revision(): RemoteRevision {
	return {
		format: REMOTE_REVISION_FORMAT,
		vaultId: "vault-12345678",
		revisionId: "revision-12345678",
		parentRevisionId: null,
		generation: 1,
		createdAt: "2026-08-01T12:00:00.000Z",
		deviceId: "device-12345678",
		deviceName: "Work laptop",
		changes: { added: 1, updated: 1, deleted: 0, conflicts: 0 },
		files: [
			{ path: "Z.md", contentHash: HASH.toUpperCase(), size: 10 },
			{ path: "A.md", contentHash: HASH, size: 5 },
		],
		ignorePatterns: ["tmp/**", "cache/**"],
	};
}

describe("encrypted remote revision format", () => {
	it("round-trips a canonical encrypted revision", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const encrypted = await encodeRemoteRevision(keys, revision());
		const decoded = await decodeRemoteRevision(keys, encrypted);

		expect(new TextDecoder().decode(encrypted)).not.toContain("A.md");
		expect(decoded.deviceName).toBe("Work laptop");
		expect(decoded.changes).toEqual({ added: 1, updated: 1, deleted: 0, conflicts: 0 });
		expect(decoded.files.map((file) => file.path)).toEqual(["A.md", "Z.md"]);
		expect(decoded.files.every((file) => file.contentHash === HASH)).toBe(true);
		expect(decoded.ignorePatterns).toEqual(["cache/**", "tmp/**"]);
	});

	it("rejects a revision encrypted with another bucket key", async () => {
		const first = await deriveKeys("first", generateSaltBase64());
		const second = await deriveKeys("second", generateSaltBase64());
		const encrypted = await encodeRemoteRevision(first, revision());

		await expect(decodeRemoteRevision(second, encrypted)).rejects.toThrow();
	});

	it("round-trips an encrypted conditional head", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const head: RemoteHead = {
			format: REMOTE_HEAD_FORMAT,
			vaultId: "vault-12345678",
			revisionId: "revision-12345678",
			generation: 1,
			history: [{ revisionId: "revision-12345678", generation: 1, createdAt: "2026-08-01T12:00:00.000Z" }],
		};

		expect(await decodeRemoteHead(keys, await encodeRemoteHead(keys, head))).toEqual(head);
		expect(remoteHeadObjectKey()).toBe("_isomite/head-v1");
	});

	it("hides revision IDs and content hashes in object keys", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const revisionKey = await remoteRevisionObjectKey(keys, "revision-12345678");
		const blobKey = await remoteBlobObjectKey(keys, HASH);

		expect(revisionKey).toMatch(/^_isomite\/revisions\/[0-9a-f]{64}$/);
		expect(revisionKey).not.toContain("revision-12345678");
		expect(blobKey).toMatch(/^_isomite\/blobs\/[0-9a-f]{64}$/);
		expect(blobKey).not.toContain(HASH);
	});
});
