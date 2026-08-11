import { App, normalizePath } from "obsidian";
import { isIgnoredPath } from "./ignore";

export interface VaultFileMeta {
	path: string;
	size: number;
	mtime: number;
}

export interface SyncVaultAdapter {
	listFiles(customIgnorePatterns?: string[]): Promise<VaultFileMeta[]>;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, bytes: Uint8Array): Promise<void>;
	trashFile(path: string): Promise<void>;
	stat(path: string): Promise<VaultFileMeta | undefined>;
}

/** Includes the configured Obsidian config folder by scanning the adapter, not Vault#getFiles. */
export class ObsidianSyncVaultAdapter implements SyncVaultAdapter {
	constructor(private readonly app: App) {}

	async listFiles(customIgnorePatterns: string[] = []): Promise<VaultFileMeta[]> {
		const files: VaultFileMeta[] = [];
		await this.walk("", customIgnorePatterns, files);
		return files.sort((left, right) => comparePaths(left.path, right.path));
	}

	async readFile(path: string): Promise<Uint8Array> {
		return new Uint8Array(await this.app.vault.adapter.readBinary(normalizeSyncPath(path)));
	}

	async writeFile(path: string, bytes: Uint8Array): Promise<void> {
		const normalized = normalizeSyncPath(path);
		await this.ensureParentFolders(normalized);
		await this.app.vault.adapter.writeBinary(normalized, toArrayBuffer(bytes));
	}

	async trashFile(path: string): Promise<void> {
		const normalized = normalizeSyncPath(path);
		if (!(await this.app.vault.adapter.exists(normalized))) return;
		// Always retain deletions in the vault-local trash for predictable
		// cross-platform recovery instead of depending on OS trash support.
		await this.app.vault.adapter.trashLocal(normalized);
	}

	async stat(path: string): Promise<VaultFileMeta | undefined> {
		const normalized = normalizeSyncPath(path);
		const stat = await this.app.vault.adapter.stat(normalized);
		return stat?.type === "file" ? { path: normalized, size: stat.size, mtime: stat.mtime } : undefined;
	}

	private async walk(folder: string, ignores: string[], output: VaultFileMeta[]): Promise<void> {
		const listing = await this.app.vault.adapter.list(folder);
		for (const file of listing.files) {
			const path = normalizeSyncPath(file);
			if (isIgnoredPath(path, ignores, this.app.vault.configDir)) continue;
			const stat = await this.app.vault.adapter.stat(path);
			if (stat?.type === "file") output.push({ path, size: stat.size, mtime: stat.mtime });
		}
		for (const child of listing.folders) {
			const path = normalizeSyncPath(child);
			if (isIgnoredPath(`${path}/placeholder`, ignores, this.app.vault.configDir)) continue;
			await this.walk(path, ignores, output);
		}
	}

	private async ensureParentFolders(path: string): Promise<void> {
		const parts = path.split("/").slice(0, -1);
		let folder = "";
		for (const part of parts) {
			folder = folder ? `${folder}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.adapter.mkdir(folder);
		}
	}
}

function normalizeSyncPath(path: string): string {
	return normalizePath(path.replace(/\\/g, "/").normalize("NFC"));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
