import { DerivedKeys, keyedContentHash } from "../crypto/crypto";
import { RevisionStore } from "./revision-store";
import { SYNC_JOURNAL_FORMAT, SyncBaseline, SyncJournal } from "./types";
import { SyncVaultAdapter } from "./vault-adapter";

export interface JournalPersistence {
	save(journal: SyncJournal | undefined): Promise<void>;
}

/** Finishes a previously approved local apply without allowing a newer sync. */
export async function resumeSyncJournal(
	journal: SyncJournal,
	vault: SyncVaultAdapter,
	store: RevisionStore,
	keys: DerivedKeys,
	persistence: JournalPersistence
): Promise<SyncBaseline> {
	if (journal.format !== SYNC_JOURNAL_FORMAT) throw new Error("Unsupported Isomite sync journal.");
	if (journal.phase !== "committed") throw new Error("An uncommitted sync journal cannot be resumed locally.");

	const targetHashByPath = new Map(journal.targetFiles.map((file) => [file.path, file.contentHash]));
	while (journal.operations.length > 0) {
		const operation = journal.operations[0];
		if (operation.type === "write") {
			if (!operation.contentHash) throw new Error(`Journal write is missing content: ${operation.path}`);
			const targetBytes = await store.getBlob(operation.contentHash);
			if (!(await alreadyHasHash(operation.path, operation.contentHash, vault, keys))) {
				await preserveUnexpectedLocalEdit(operation.path, operation.expectedLocalHash, journal.createdAt, vault, keys);
				await vault.writeFile(operation.path, targetBytes);
			}
		} else {
			if (await vault.stat(operation.path)) {
				await preserveUnexpectedLocalEdit(operation.path, operation.expectedLocalHash, journal.createdAt, vault, keys);
				await vault.trashFile(operation.path);
			}
		}
		await assertOperationApplied(operation, targetHashByPath.get(operation.path), vault, keys);
		journal.operations.shift();
		await persistence.save(journal);
	}

	await persistence.save(undefined);
	const localMetadata = await Promise.all(journal.targetFiles.map((file) => vault.stat(file.path)));
	return {
		format: "isomite-sync-baseline-v1",
		vaultId: journal.targetVaultId,
		revisionId: journal.targetRevisionId,
		generation: journal.targetGeneration,
		files: journal.targetFiles.map((file, index) => ({ ...file, mtime: localMetadata[index]?.mtime })),
	};
}

async function alreadyHasHash(
	path: string,
	expectedHash: string,
	vault: SyncVaultAdapter,
	keys: DerivedKeys
): Promise<boolean> {
	if (!(await vault.stat(path))) return false;
	return keyedContentHash(keys.contentHashKey, await vault.readFile(path)).then((hash) => hash === expectedHash);
}

async function assertOperationApplied(
	operation: SyncJournal["operations"][number],
	targetHash: string | undefined,
	vault: SyncVaultAdapter,
	keys: DerivedKeys
): Promise<void> {
	const current = await vault.stat(operation.path);
	if (operation.type === "trash") {
		if (current) throw new Error(`Local deletion did not complete: ${operation.path}`);
		return;
	}
	if (!current || !targetHash) throw new Error(`Local write did not complete: ${operation.path}`);
	const bytes = await vault.readFile(operation.path);
	if ((await keyedContentHash(keys.contentHashKey, bytes)) !== targetHash) {
		throw new Error(`Local write verification failed: ${operation.path}`);
	}
}

async function preserveUnexpectedLocalEdit(
	path: string,
	expectedHash: string | undefined,
	createdAt: string,
	vault: SyncVaultAdapter,
	keys: DerivedKeys
): Promise<void> {
	const current = await vault.stat(path);
	if (!current) return;
	const bytes = await vault.readFile(path);
	if (expectedHash && (await keyedContentHash(keys.contentHashKey, bytes)) === expectedHash) return;
	await writeUniqueConflictCopy(conflictCopyPath(path, createdAt), bytes, vault);
}

async function writeUniqueConflictCopy(basePath: string, bytes: Uint8Array, vault: SyncVaultAdapter): Promise<void> {
	for (let suffix = 1; suffix < 10_000; suffix++) {
		const candidate = suffix === 1 ? basePath : appendSuffix(basePath, suffix);
		if (!(await vault.stat(candidate))) {
			await vault.writeFile(candidate, bytes);
			return;
		}
	}
	throw new Error(`Unable to preserve a recovery conflict copy: ${basePath}`);
}

function appendSuffix(path: string, suffix: number): string {
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	const extensionStart = dot > slash + 1 ? dot : path.length;
	return `${path.slice(0, extensionStart)} ${suffix}${path.slice(extensionStart)}`;
}

function conflictCopyPath(path: string, createdAt: string): string {
	const lastSlash = path.lastIndexOf("/");
	const lastDot = path.lastIndexOf(".");
	const extensionStart = lastDot > lastSlash + 1 ? lastDot : path.length;
	const timestamp = createdAt.replace(/[:.]/g, "-");
	return `${path.slice(0, extensionStart)} (recovery conflict ${timestamp})${path.slice(extensionStart)}`;
}
