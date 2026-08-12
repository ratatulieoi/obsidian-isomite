import { describe, expect, it } from "vitest";
import { deriveKeys, generateSaltBase64, keyedContentHash } from "../src/crypto/crypto";
import { resumeSyncJournal } from "../src/sync/journal";
import { RevisionStore } from "../src/sync/revision-store";
import { SYNC_JOURNAL_FORMAT, SyncJournal } from "../src/sync/types";
import { SyncVaultAdapter, VaultFileMeta } from "../src/sync/vault-adapter";

class JournalVault implements SyncVaultAdapter {
	readonly files = new Map<string, Uint8Array>();
	async listFiles(): Promise<VaultFileMeta[]> { return []; }
	async readFile(path: string): Promise<Uint8Array> { return this.files.get(path)!; }
	async writeFile(path: string, bytes: Uint8Array): Promise<void> { this.files.set(path, bytes); }
	async trashFile(path: string): Promise<void> { this.files.delete(path); }
	async stat(path: string): Promise<VaultFileMeta | undefined> {
		const bytes = this.files.get(path);
		return bytes ? { path, size: bytes.byteLength, mtime: 1 } : undefined;
	}
}

describe("sync journal progress", () => {
	it("reports committed local application progress", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const bytes = new TextEncoder().encode("note");
		const contentHash = await keyedContentHash(keys.contentHashKey, bytes);
		const vault = new JournalVault();
		const saves: Array<SyncJournal | undefined> = [];
		const progress: number[] = [];
		const journal: SyncJournal = {
			format: SYNC_JOURNAL_FORMAT,
			phase: "committed",
			targetVaultId: "vault-12345678",
			targetRevisionId: "revision-12345678",
			targetGeneration: 1,
			targetFiles: [{ path: "Note.md", contentHash, size: bytes.byteLength }],
			operations: [{ type: "write", path: "Note.md", contentHash }],
			createdAt: "2026-08-01T00:00:00.000Z",
		};
		const store = { getBlob: async () => bytes } as unknown as RevisionStore;

		const baseline = await resumeSyncJournal(
			journal,
			vault,
			store,
			keys,
			{ save: async (value) => { saves.push(value); } },
			(update) => progress.push(update.percent)
		);

		expect(new TextDecoder().decode(vault.files.get("Note.md"))).toBe("note");
		expect(baseline.revisionId).toBe("revision-12345678");
		expect(progress).toEqual([99]);
		expect(saves.at(-1)).toBeUndefined();
	});
});
