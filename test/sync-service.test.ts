import { describe, expect, it } from "vitest";
import { deriveKeys, generateSaltBase64, keyedContentHash } from "../src/crypto/crypto";
import { createSyncPlan } from "../src/sync/sync-service";
import { REMOTE_HEAD_FORMAT, REMOTE_REVISION_FORMAT, SYNC_BASELINE_FORMAT } from "../src/sync/types";

function store(contentHash: string) {
	return {
		readHead: async () => ({
			head: {
				format: REMOTE_HEAD_FORMAT,
				vaultId: "vault-12345678",
				revisionId: "revision-11111111",
				generation: 1,
				history: [{ revisionId: "revision-11111111", generation: 1, createdAt: "2026-08-01T00:00:00.000Z" }],
			},
			etag: "etag-1",
		}),
		readRevision: async () => ({
			format: REMOTE_REVISION_FORMAT,
			vaultId: "vault-12345678",
			revisionId: "revision-11111111",
			parentRevisionId: null,
			generation: 1,
			createdAt: "2026-08-01T00:00:00.000Z",
			deviceId: "device-12345678",
			files: [{ path: "Note.md", contentHash, size: 4 }],
			ignorePatterns: [],
		}),
	};
}

describe("sync state recovery", () => {
	it("rebuilds a stale local checkpoint against the current R2 revision", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const contentHash = await keyedContentHash(keys.contentHashKey, new TextEncoder().encode("note"));
		const baseline = {
			format: SYNC_BASELINE_FORMAT,
			vaultId: "vault-12345678",
			revisionId: "revision-22222222",
			generation: 2,
			files: [{ path: "Note.md", contentHash, size: 4, mtime: 1 }],
		};
		const planned = await createSyncPlan({
			vault: {
				listFiles: async () => [{ path: "Note.md", size: 4, mtime: 1 }],
				readFile: async () => new TextEncoder().encode("note"),
				writeFile: async () => undefined,
				trashFile: async () => undefined,
				stat: async () => ({ path: "Note.md", size: 4, mtime: 1 }),
			},
			store: store(contentHash) as never,
			keys,
			baseline,
			localVaultId: baseline.vaultId,
			configDir: ".config-folder",
		});

		expect(planned.plan.rebuildingSyncState).toBe(true);
		expect(planned.plan.entries).toEqual([
			expect.objectContaining({ path: "Note.md", action: "noop", reason: "alreadyEqual" }),
		]);
	});
});
