import { DerivedKeys, keyedContentHash } from "../crypto/crypto";
import { assertLocalPlanStillCurrent } from "./scanner";
import { JournalPersistence } from "./journal";
import { RevisionStore, StoredHead } from "./revision-store";
import { assertNoPathCollisions } from "./path-guards";
import { reportProgress, SyncCancelledError, SyncProgressCallback } from "./progress";
import {
	FileState,
	REMOTE_REVISION_FORMAT,
	RemoteRevision,
	RemoteRevisionFile,
	SYNC_JOURNAL_FORMAT,
	SyncJournal,
	SyncPlan,
} from "./types";
import { SyncVaultAdapter } from "./vault-adapter";

export interface DeleteVsEditDecision {
	path: string;
	winner: "delete" | "edit";
}

export interface PreparedSync {
	/** Undefined for pull/local-delete-only plans that do not change R2. */
	revision?: RemoteRevision;
	journal: SyncJournal;
	localExpectations: Array<{ path: string; state?: FileState }>;
	ignorePatterns: string[];
}

export interface PrepareSyncInput {
	plan: SyncPlan;
	vault: SyncVaultAdapter;
	store: RevisionStore;
	keys: DerivedKeys;
	vaultId: string;
	deviceId: string;
	remoteFiles: RemoteRevisionFile[];
	remoteIgnorePatterns: string[];
	remoteHead?: StoredHead;
	ignorePatterns: string[];
	decisions?: DeleteVsEditDecision[];
	now?: Date;
	revisionId?: string;
	onProgress?: SyncProgressCallback;
	signal?: AbortSignal;
}

/**
 * Resolves the reviewed plan into uploaded immutable blobs, a candidate remote
 * revision, and a durable local-apply journal. It does not advance R2 head.
 */
export async function prepareSync(input: PrepareSyncInput): Promise<PreparedSync> {
	throwIfCancelled(input.signal);
	const localExpectations = input.plan.entries.map((entry) => ({ path: entry.path, state: entry.local }));
	await assertLocalPlanStillCurrent(input.vault, input.keys, localExpectations, input.ignorePatterns);
	const files = new Map(input.remoteFiles.map((file) => [file.path, { ...file }]));
	const operations: SyncJournal["operations"] = [];
	const decisions = new Map((input.decisions ?? []).map((decision) => [decision.path, decision.winner]));
	const now = input.now ?? new Date();

	const activeEntries = input.plan.entries.filter((entry) => entry.action !== "noop");
	let processedEntries = 0;
	for (const entry of input.plan.entries) {
		throwIfCancelled(input.signal);
		switch (entry.action) {
			case "noop":
				break;
			case "upload": {
				const uploaded = await uploadLocal(input, entry.path, entry.local);
				files.set(entry.path, uploaded);
				break;
			}
			case "download":
				if (!entry.remote) throw invalidEntry(entry.path);
				operations.push(writeOperation(entry.path, entry.remote, entry.local));
				break;
			case "deleteLocal":
				operations.push({ type: "trash", path: entry.path, expectedLocalHash: entry.local?.contentHash });
				break;
			case "deleteRemote":
				files.delete(entry.path);
				break;
			case "keepBoth": {
				if (!entry.local) throw invalidEntry(entry.path);
				const copyPath = allocateConflictCopyPath(entry.path, input.deviceId, now, files, input.plan);
				const uploaded = await uploadLocal(input, copyPath, entry.local, entry.path);
				files.set(copyPath, uploaded);
				operations.push({ type: "write", path: copyPath, contentHash: uploaded.contentHash });
				if (entry.remote) operations.push(writeOperation(entry.path, entry.remote, entry.local));
				break;
			}
			case "mergeText": {
				if (!entry.resolvedContent) throw new Error(`Merge result must be resolved before preparing sync: ${entry.path}`);
				const result = await input.store.putBlob(entry.resolvedContent);
				files.set(entry.path, { path: entry.path, contentHash: result.contentHash, size: entry.resolvedContent.byteLength });
				operations.push({
					type: "write",
					path: entry.path,
					contentHash: result.contentHash,
					expectedLocalHash: entry.local?.contentHash,
				});
				break;
			}
			case "chooseDeleteOrEdit": {
				const winner = decisions.get(entry.path);
				if (!winner) throw new Error(`Choose deletion or edited content before applying: ${entry.path}`);
				await applyDeleteVsEditChoice(input, entry.path, winner, entry.local, entry.remote, files, operations);
				break;
			}
		}
		if (entry.action !== "noop") {
			processedEntries++;
			reportProgress(
				input.onProgress,
				35 + (processedEntries / Math.max(activeEntries.length, 1)) * 40,
				`Preparing ${processedEntries} of ${activeEntries.length} changes`
			);
		}
	}

	assertExpectedRemoteHead(input);
	const targetFiles = [...files.values()].sort(compareFiles);
	assertNoPathCollisions(targetFiles);
	const remoteChanged = !sameRemoteFiles(targetFiles, input.remoteFiles) ||
		!sameStrings([...input.ignorePatterns].sort(), [...input.remoteIgnorePatterns].sort());
	const revision: RemoteRevision | undefined = remoteChanged
		? {
				format: REMOTE_REVISION_FORMAT,
				vaultId: input.vaultId,
				revisionId: input.revisionId ?? randomId("revision"),
				parentRevisionId: input.remoteHead?.head.revisionId ?? null,
				generation: (input.remoteHead?.head.generation ?? 0) + 1,
				createdAt: now.toISOString(),
				deviceId: input.deviceId,
				files: targetFiles,
				ignorePatterns: [...input.ignorePatterns].sort(),
			}
		: undefined;
	const targetRevisionId = revision?.revisionId ?? input.remoteHead?.head.revisionId;
	const targetGeneration = revision?.generation ?? input.remoteHead?.head.generation;
	if (!targetRevisionId || targetGeneration === undefined) {
		throw new Error("A local-only apply requires an existing remote revision.");
	}
	const journal: SyncJournal = {
		format: SYNC_JOURNAL_FORMAT,
		phase: "prepared",
		targetVaultId: input.vaultId,
		targetRevisionId,
		targetGeneration,
		targetFiles,
		operations,
		createdAt: now.toISOString(),
	};
	// Uploading a large plan can take time. Verify every reviewed local path a
	// second time immediately before allowing the conditional remote commit.
	throwIfCancelled(input.signal);
	await assertLocalPlanStillCurrent(input.vault, input.keys, localExpectations, input.ignorePatterns);
	throwIfCancelled(input.signal);
	return { revision, journal, localExpectations, ignorePatterns: input.ignorePatterns };
}

/** Persists intent, conditionally commits R2, then marks the journal resumable. */
export async function commitPreparedSync(
	prepared: PreparedSync,
	store: RevisionStore,
	persistence: JournalPersistence,
	vault: SyncVaultAdapter,
	keys: DerivedKeys,
	expectedHead?: StoredHead
): Promise<StoredHead> {
	await assertLocalPlanStillCurrent(vault, keys, prepared.localExpectations, prepared.ignorePatterns);
	await persistence.save(prepared.journal);
	try {
		const head = prepared.revision
			? await store.commitRevision(prepared.revision, expectedHead)
			: expectedHead && await store.revalidateHead(expectedHead);
		if (!head) throw new Error("A local-only apply requires an existing remote head.");
		prepared.journal.phase = "committed";
		await persistence.save(prepared.journal);
		return head;
	} catch (error) {
		await persistence.save(undefined);
		throw error;
	}
}

async function uploadLocal(
	input: PrepareSyncInput,
	targetPath: string,
	local: FileState | undefined,
	sourcePath = targetPath
): Promise<RemoteRevisionFile> {
	if (!local) throw invalidEntry(targetPath);
	const existingBlob = input.remoteFiles.find(
		(file) => file.contentHash === local.contentHash && file.size === local.size
	);
	if (existingBlob) {
		return { path: targetPath, contentHash: existingBlob.contentHash, size: existingBlob.size };
	}
	const bytes = await input.vault.readFile(sourcePath);
	const currentHash = await keyedContentHash(input.keys.contentHashKey, bytes);
	if (currentHash !== local.contentHash) throw new Error(`The reviewed file changed during upload: ${sourcePath}`);
	const result = await input.store.putBlob(bytes);
	return { path: targetPath, contentHash: result.contentHash, size: bytes.byteLength };
}

async function applyDeleteVsEditChoice(
	input: PrepareSyncInput,
	path: string,
	winner: "delete" | "edit",
	local: FileState | undefined,
	remote: RemoteRevisionFile | undefined,
	files: Map<string, RemoteRevisionFile>,
	operations: SyncJournal["operations"]
): Promise<void> {
	if (winner === "delete") {
		files.delete(path);
		if (local) operations.push({ type: "trash", path, expectedLocalHash: local.contentHash });
		return;
	}
	if (local) {
		files.set(path, await uploadLocal(input, path, local));
		return;
	}
	if (remote) {
		files.set(path, remote);
		operations.push(writeOperation(path, remote));
		return;
	}
	throw invalidEntry(path);
}

function writeOperation(path: string, remote: RemoteRevisionFile, local?: FileState) {
	return { type: "write" as const, path, contentHash: remote.contentHash, expectedLocalHash: local?.contentHash };
}

function allocateConflictCopyPath(
	path: string,
	deviceId: string,
	now: Date,
	remoteFiles: Map<string, RemoteRevisionFile>,
	plan: SyncPlan
): string {
	const occupied = new Set([...remoteFiles.keys(), ...plan.entries.flatMap((entry) => [entry.path, entry.conflictCopyPath ?? ""])]);
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	const extensionStart = dot > slash + 1 ? dot : path.length;
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const safeDevice = deviceId.replace(/[^A-Za-z0-9_-]/g, "-");
	const base = `${path.slice(0, extensionStart)} (conflict ${safeDevice} ${stamp})`;
	const extension = path.slice(extensionStart);
	for (let suffix = 1; suffix < 10_000; suffix++) {
		const candidate = `${base}${suffix === 1 ? "" : ` ${suffix}`}${extension}`;
		if (!occupied.has(candidate)) return candidate;
	}
	throw new Error(`Unable to allocate a conflict copy for ${path}`);
}

function assertExpectedRemoteHead(input: PrepareSyncInput): void {
	const expectedRevisionId = input.remoteHead?.head.revisionId ?? null;
	if (input.plan.remoteRevisionId !== expectedRevisionId) {
		throw new Error("The reviewed plan does not match the expected remote head.");
	}
	if (input.remoteHead && input.remoteHead.head.vaultId !== input.vaultId) {
		throw new Error("The expected remote head belongs to another vault.");
	}
}

function sameRemoteFiles(left: RemoteRevisionFile[], right: RemoteRevisionFile[]): boolean {
	const sortedRight = [...right].sort(compareFiles);
	return left.length === sortedRight.length && left.every((file, index) =>
		file.path === sortedRight[index].path &&
		file.contentHash === sortedRight[index].contentHash &&
		file.size === sortedRight[index].size
	);
}

function sameStrings(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new SyncCancelledError();
}

function invalidEntry(path: string): Error {
	return new Error(`The sync plan entry is incomplete: ${path}`);
}

function randomId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

function compareFiles(left: RemoteRevisionFile, right: RemoteRevisionFile): number {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
