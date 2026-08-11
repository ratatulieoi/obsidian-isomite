import { describe, expect, it } from "vitest";
import { deriveKeys, generateSaltBase64, keyedContentHash } from "../src/crypto/crypto";
import { assertLocalPlanStillCurrent, scanLocalFiles, StaleSyncPlanError } from "../src/sync/scanner";
import { SYNC_BASELINE_FORMAT, SyncBaseline } from "../src/sync/types";
import { SyncVaultAdapter, VaultFileMeta } from "../src/sync/vault-adapter";

class MemoryVault implements SyncVaultAdapter {
	readonly files = new Map<string, { bytes: Uint8Array; mtime: number }>();
	reads = 0;

	async listFiles(): Promise<VaultFileMeta[]> {
		return [...this.files].map(([path, value]) => ({ path, size: value.bytes.byteLength, mtime: value.mtime }));
	}
	async readFile(path: string): Promise<Uint8Array> {
		this.reads++;
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

describe("local scanner", () => {
	it("reuses baseline hashes when size and mtime are unchanged", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const vault = new MemoryVault();
		const bytes = new TextEncoder().encode("same");
		const contentHash = await keyedContentHash(keys.contentHashKey, bytes);
		vault.files.set("Note.md", { bytes, mtime: 10 });
		const baseline: SyncBaseline = {
			format: SYNC_BASELINE_FORMAT,
			vaultId: "vault-12345678",
			revisionId: "revision-12345678",
			generation: 1,
			files: [{ path: "Note.md", size: bytes.byteLength, mtime: 10, contentHash }],
		};

		const result = await scanLocalFiles(vault, keys, baseline);

		expect(result[0].contentHash).toBe(contentHash);
		expect(vault.reads).toBe(0);
	});

	it("detects a local file changed after review", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const vault = new MemoryVault();
		const original = new TextEncoder().encode("old");
		vault.files.set("Note.md", { bytes: original, mtime: 1 });
		const expected = {
			path: "Note.md",
			size: original.byteLength,
			mtime: 1,
			contentHash: await keyedContentHash(keys.contentHashKey, original),
		};
		vault.files.set("Note.md", { bytes: new TextEncoder().encode("new"), mtime: 2 });

		await expect(assertLocalPlanStillCurrent(vault, keys, [{ path: expected.path, state: expected }])).rejects.toBeInstanceOf(
			StaleSyncPlanError
		);
	});

	it("detects a new path created after review", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const vault = new MemoryVault();
		vault.files.set("New.md", { bytes: new TextEncoder().encode("new"), mtime: 1 });

		await expect(assertLocalPlanStillCurrent(vault, keys, [])).rejects.toBeInstanceOf(StaleSyncPlanError);
	});
});
