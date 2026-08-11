import { describe, expect, it } from "vitest";
import { deriveKeys, generateSaltBase64, keyedContentHash } from "../src/crypto/crypto";
import { prepareSync } from "../src/sync/executor";
import { RevisionStore } from "../src/sync/revision-store";
import { SyncPlan } from "../src/sync/types";
import { SyncVaultAdapter, VaultFileMeta } from "../src/sync/vault-adapter";

class MemoryVault implements SyncVaultAdapter {
	readonly files = new Map<string, { bytes: Uint8Array; mtime: number }>();
	async listFiles(): Promise<VaultFileMeta[]> {
		return [...this.files].map(([path, file]) => ({ path, size: file.bytes.byteLength, mtime: file.mtime }));
	}
	async readFile(path: string): Promise<Uint8Array> {
		const file = this.files.get(path);
		if (!file) throw new Error("missing");
		return file.bytes;
	}
	async writeFile(): Promise<void> {}
	async trashFile(): Promise<void> {}
	async stat(path: string): Promise<VaultFileMeta | undefined> {
		const file = this.files.get(path);
		return file ? { path, size: file.bytes.byteLength, mtime: file.mtime } : undefined;
	}
}

function fakeStore(): RevisionStore & { uploads: Uint8Array[] } {
	const uploads: Uint8Array[] = [];
	return {
		uploads,
		putBlob: async (bytes: Uint8Array) => {
			uploads.push(bytes);
			return { contentHash: "ab".repeat(32), objectKey: "blob", uploaded: true };
		},
	} as unknown as RevisionStore & { uploads: Uint8Array[] };
}

describe("prepareSync", () => {
	it("uploads reviewed local changes into a first immutable revision", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const vault = new MemoryVault();
		const bytes = new TextEncoder().encode("note");
		vault.files.set("Note.md", { bytes, mtime: 1 });
		const state = {
			path: "Note.md",
			contentHash: await keyedContentHash(keys.contentHashKey, bytes),
			size: bytes.byteLength,
			mtime: 1,
		};
		const plan: SyncPlan = {
			mode: "initialUpload",
			baseRevisionId: null,
			remoteRevisionId: null,
			entries: [{ path: "Note.md", action: "upload", reason: "localCreated", local: state }],
		};
		const store = fakeStore();

		const prepared = await prepareSync({
			plan,
			vault,
			store,
			keys,
			vaultId: "vault-12345678",
			deviceId: "device-12345678",
			remoteFiles: [],
			remoteIgnorePatterns: [],
			ignorePatterns: [],
			now: new Date("2026-08-01T00:00:00.000Z"),
			revisionId: "revision-12345678",
		});

		expect(prepared.revision?.generation).toBe(1);
		expect(prepared.revision?.files).toEqual([{ path: "Note.md", contentHash: "ab".repeat(32), size: 4 }]);
		expect(prepared.journal.operations).toEqual([]);
		expect(store.uploads).toHaveLength(1);
	});

	it("requires an explicit decision for delete-versus-edit", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const vault = new MemoryVault();
		const remote = { path: "Draft.md", contentHash: "ab".repeat(32), size: 4 };
		const plan: SyncPlan = {
			mode: "normal",
			baseRevisionId: "revision-11111111",
			remoteRevisionId: "revision-11111111",
			entries: [
				{
					path: "Draft.md",
					action: "chooseDeleteOrEdit",
					reason: "deleteVsEdit",
					remote,
					decision: { deletedOn: "local", editedOn: "remote" },
				},
			],
		};
		const remoteHead = {
			head: {
				format: "isomite-head-v1" as const,
				vaultId: "vault-12345678",
				revisionId: "revision-11111111",
				generation: 1,
				history: [{ revisionId: "revision-11111111", generation: 1, createdAt: "2026-08-01T00:00:00.000Z" }],
			},
			etag: "etag-1",
		};

		await expect(
			prepareSync({
				plan,
				vault,
				store: fakeStore(),
				keys,
				vaultId: remoteHead.head.vaultId,
				deviceId: "device-12345678",
				remoteFiles: [remote],
				remoteIgnorePatterns: [],
				remoteHead,
				ignorePatterns: [],
			})
		).rejects.toThrow("Choose deletion or edited content");
	});
});
