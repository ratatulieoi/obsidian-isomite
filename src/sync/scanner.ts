import { DerivedKeys, keyedContentHash } from "../crypto/crypto";
import { SyncCancelledError, SyncProgressCallback } from "./progress";
import { FileState, SyncBaseline } from "./types";
import { SyncVaultAdapter } from "./vault-adapter";

export async function scanLocalFiles(
	vault: SyncVaultAdapter,
	keys: DerivedKeys,
	baseline?: SyncBaseline,
	ignorePatterns: string[] = [],
	onProgress?: SyncProgressCallback,
	signal?: AbortSignal
): Promise<FileState[]> {
	const baselineByPath = new Map((baseline?.files ?? []).map((file) => [file.path, file]));
	const metadata = await vault.listFiles(ignorePatterns);
	const states: FileState[] = [];

	let completedFiles = 0;
	for (const file of metadata) {
		if (signal?.aborted) throw new SyncCancelledError();
		const previous = baselineByPath.get(file.path);
		if (previous && previous.mtime === file.mtime && previous.size === file.size) {
			states.push({ ...file, contentHash: previous.contentHash });
			completedFiles++;
			reportScanProgress(onProgress, completedFiles, metadata.length);
			continue;
		}
		const bytes = await vault.readFile(file.path);
		if (bytes.byteLength !== file.size) throw new Error(`File changed while scanning: ${file.path}`);
		states.push({ ...file, contentHash: await keyedContentHash(keys.contentHashKey, bytes) });
		completedFiles++;
		reportScanProgress(onProgress, completedFiles, metadata.length);
	}
	if (signal?.aborted) throw new SyncCancelledError();
	if (metadata.length === 0) reportScanProgress(onProgress, 0, 0);
	return states;
}

/** Exact stale-review check for every affected local path. */
export async function assertLocalPlanStillCurrent(
	vault: SyncVaultAdapter,
	keys: DerivedKeys,
	expectations: Array<{ path: string; state?: FileState }>,
	ignorePatterns: string[] = []
): Promise<void> {
	const expectedByPath = new Map(expectations.map((expectation) => [expectation.path, expectation.state]));
	const currentFiles = await vault.listFiles(ignorePatterns);
	const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));

	for (const [path, expected] of expectedByPath) {
		const current = currentByPath.get(path);
		if (!expected) {
			if (current) throw new StaleSyncPlanError(path);
			continue;
		}
		if (!current || current.size !== expected.size) throw new StaleSyncPlanError(path);
		const bytes = await vault.readFile(path);
		const hash = await keyedContentHash(keys.contentHashKey, bytes);
		if (hash !== expected.contentHash) throw new StaleSyncPlanError(path);
	}

	for (const path of currentByPath.keys()) {
		if (!expectedByPath.has(path)) throw new StaleSyncPlanError(path);
	}
}

function reportScanProgress(callback: SyncProgressCallback | undefined, completed: number, total: number): void {
	callback?.({
		percent: total === 0 ? 30 : 15 + Math.round((completed / total) * 15),
		stage: total === 0 ? "Local scan complete" : `Scanning ${completed} of ${total} local files`,
	});
}

export class StaleSyncPlanError extends Error {
	constructor(path: string) {
		super(`The reviewed sync plan is stale because this file changed: ${path}`);
		this.name = "StaleSyncPlanError";
	}
}
