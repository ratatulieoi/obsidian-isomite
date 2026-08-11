import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createVaultZipBackup } from "../src/sync/backup";
import { SyncVaultAdapter, VaultFileMeta } from "../src/sync/vault-adapter";

class BackupVault implements SyncVaultAdapter {
	private files = new Map([
		["Note.md", new TextEncoder().encode("note")],
		["Folder/Data.bin", new Uint8Array([1, 2, 3])],
	]);
	async listFiles(): Promise<VaultFileMeta[]> {
		return [...this.files].map(([path, bytes]) => ({ path, size: bytes.byteLength, mtime: 1_700_000_000_000 }));
	}
	async readFile(path: string): Promise<Uint8Array> { return this.files.get(path)!; }
	async writeFile(): Promise<void> {}
	async trashFile(): Promise<void> {}
	async stat(): Promise<VaultFileMeta | undefined> { return undefined; }
}

describe("first-sync backup", () => {
	it("creates a valid ZIP containing every scanned vault file", async () => {
		const files = unzipSync(await createVaultZipBackup(new BackupVault()));

		expect(strFromU8(files["Note.md"])).toBe("note");
		expect(files["Folder/Data.bin"]).toEqual(new Uint8Array([1, 2, 3]));
	});
});
