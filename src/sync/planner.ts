import {
	BaselineFileState,
	FileState,
	RemoteRevisionFile,
	SyncBaseline,
	SyncPlan,
	SyncPlanEntry,
	SyncPlanMode,
} from "./types";

export interface BuildSyncPlanInput {
	baseline?: SyncBaseline;
	localFiles: FileState[];
	remoteFiles: RemoteRevisionFile[];
	remoteRevisionId: string | null;
	/**
	 * Explicitly chosen when an established bucket is paired with a device whose
	 * local vault already contains files. Matching remote paths replace local
	 * paths; local-only paths are uploaded after the adoption pass.
	 */
	adoptEstablishedRemote?: boolean;
	/** Explicit lost-history recovery choice: replace established R2 with local. */
	adoptLocalOverRemote?: boolean;
	/** Paths removed from scope by newly approved global ignore rules. */
	ignoredRemotePaths?: string[];
}

/** Pure three-way classification. It never reads, writes, merges, or deletes. */
export function buildSyncPlan(input: BuildSyncPlanInput): SyncPlan {
	const local = uniqueByPath(input.localFiles, "local");
	const remote = uniqueByPath(input.remoteFiles, "remote");
	const base = uniqueByPath(input.baseline?.files ?? [], "baseline");
	const mode = determineMode(input, local.size, remote.size);

	const ignoredRemotePaths = new Set((input.ignoredRemotePaths ?? []).map(normalizePath));
	const allPaths = new Set([...base.keys(), ...local.keys(), ...remote.keys(), ...ignoredRemotePaths]);
	const entries = [...allPaths]
		.sort(comparePaths)
		.map((path) => ignoredRemotePaths.has(path) && remote.has(path)
			? { path, base: base.get(path), local: local.get(path), remote: remote.get(path), action: "deleteRemote" as const, reason: "localDeleted" as const }
			: classify(path, base.get(path), local.get(path), remote.get(path), mode));

	return {
		mode,
		baseRevisionId: input.baseline?.revisionId ?? null,
		remoteRevisionId: input.remoteRevisionId,
		entries,
	};
}

function determineMode(input: BuildSyncPlanInput, localCount: number, remoteCount: number): SyncPlanMode {
	if (input.baseline) return "normal";
	if (input.adoptEstablishedRemote && input.adoptLocalOverRemote) {
		throw new Error("Choose only one lost-history recovery direction.");
	}
	if (input.adoptLocalOverRemote) return "adoptLocal";
	if (input.adoptEstablishedRemote) return "adoptRemote";
	if (remoteCount === 0 && localCount > 0) return "initialUpload";
	if (localCount === 0 && remoteCount > 0) return "initialDownload";
	return "normal";
}

function classify(
	path: string,
	base: BaselineFileState | undefined,
	local: FileState | undefined,
	remote: RemoteRevisionFile | undefined,
	mode: SyncPlanMode
): SyncPlanEntry {
	const state = { path, base, local, remote };

	if (mode === "adoptLocal") {
		if (local) {
			return remote && sameContent(local, remote)
				? { ...state, action: "noop", reason: "alreadyEqual" }
				: { ...state, action: "upload", reason: remote ? "localChanged" : "localCreated" };
		}
		if (remote) return { ...state, action: "deleteRemote", reason: "localDeleted" };
	}

	if (mode === "adoptRemote") {
		if (remote) {
			return local && sameContent(local, remote)
				? { ...state, action: "noop", reason: "alreadyEqual" }
				: { ...state, action: "download", reason: "adoptRemote" };
		}
		if (local) return { ...state, action: "upload", reason: "localCreated" };
	}

	if (!base) {
		if (local && remote) {
			return sameContent(local, remote)
				? { ...state, action: "noop", reason: "alreadyEqual" }
				: { ...state, action: "keepBoth", reason: "sameNewPath" };
		}
		if (local) return { ...state, action: "upload", reason: "localCreated" };
		if (remote) return { ...state, action: "download", reason: "remoteCreated" };
	}

	if (base) {
		if (!local && !remote) return { ...state, action: "noop", reason: "bothDeleted" };

		if (local && !remote) {
			if (sameContent(local, base)) return { ...state, action: "deleteLocal", reason: "remoteDeleted" };
			return {
				...state,
				action: "chooseDeleteOrEdit",
				reason: "deleteVsEdit",
				decision: { deletedOn: "remote", editedOn: "local" },
			};
		}

		if (!local && remote) {
			if (sameContent(remote, base)) return { ...state, action: "deleteRemote", reason: "localDeleted" };
			return {
				...state,
				action: "chooseDeleteOrEdit",
				reason: "deleteVsEdit",
				decision: { deletedOn: "local", editedOn: "remote" },
			};
		}

		if (local && remote) {
			const localChanged = !sameContent(local, base);
			const remoteChanged = !sameContent(remote, base);

			if (!localChanged && !remoteChanged) return { ...state, action: "noop", reason: "alreadyEqual" };
			if (localChanged && !remoteChanged) return { ...state, action: "upload", reason: "localChanged" };
			if (!localChanged && remoteChanged) return { ...state, action: "download", reason: "remoteChanged" };
			if (sameContent(local, remote)) return { ...state, action: "noop", reason: "alreadyEqual" };
			return {
				...state,
				action: isMergeableTextPath(path) ? "mergeText" : "keepBoth",
				reason: "bothChanged",
			};
		}
	}

	throw new Error(`Unable to classify sync path: ${path}`);
}

function sameContent(left: { contentHash: string }, right: { contentHash: string }): boolean {
	return left.contentHash === right.contentHash;
}

function uniqueByPath<T extends { path: string }>(files: T[], source: string): Map<string, T> {
	const result = new Map<string, T>();
	for (const file of files) {
		const path = normalizePath(file.path);
		if (!path) throw new Error(`${source} contains an empty path.`);
		if (result.has(path)) throw new Error(`${source} contains a duplicate path: ${path}`);
		result.set(path, path === file.path ? file : { ...file, path });
	}
	return result;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").normalize("NFC").replace(/^\/+/, "");
}

function isMergeableTextPath(path: string): boolean {
	const lower = path.toLowerCase();
	return lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx") || lower.endsWith(".txt");
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
