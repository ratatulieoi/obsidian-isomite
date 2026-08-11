export const SYNC_BASELINE_FORMAT = "isomite-sync-baseline-v1" as const;
export const REMOTE_REVISION_FORMAT = "isomite-revision-v1" as const;
export const REMOTE_HEAD_FORMAT = "isomite-head-v1" as const;

export interface FileState {
	path: string;
	contentHash: string;
	size: number;
	mtime?: number;
}

export interface BaselineFileState extends FileState {
	/** Last local mtime observed after this revision was fully applied. */
	mtime?: number;
}

export interface SyncBaseline {
	format: typeof SYNC_BASELINE_FORMAT;
	vaultId: string;
	revisionId: string;
	generation: number;
	files: BaselineFileState[];
}

export interface RemoteRevisionFile {
	path: string;
	contentHash: string;
	size: number;
}

export interface RemoteRevision {
	format: typeof REMOTE_REVISION_FORMAT;
	vaultId: string;
	revisionId: string;
	parentRevisionId: string | null;
	generation: number;
	createdAt: string;
	deviceId: string;
	files: RemoteRevisionFile[];
	ignorePatterns: string[];
}

export interface RemoteHeadHistoryEntry {
	revisionId: string;
	generation: number;
	createdAt: string;
}

export interface RemoteHead {
	format: typeof REMOTE_HEAD_FORMAT;
	vaultId: string;
	revisionId: string;
	generation: number;
	/** Retained newest-first revisions; the first entry is always this head. */
	history: RemoteHeadHistoryEntry[];
}

export type SyncAction =
	| "noop"
	| "upload"
	| "download"
	| "deleteLocal"
	| "deleteRemote"
	| "mergeText"
	| "keepBoth"
	| "chooseDeleteOrEdit";

export type PlanReason =
	| "localCreated"
	| "remoteCreated"
	| "localChanged"
	| "remoteChanged"
	| "localDeleted"
	| "remoteDeleted"
	| "bothChanged"
	| "sameNewPath"
	| "deleteVsEdit"
	| "alreadyEqual"
	| "bothDeleted"
	| "adoptRemote";

export interface SyncPlanEntry {
	path: string;
	action: SyncAction;
	reason: PlanReason;
	base?: BaselineFileState;
	local?: FileState;
	remote?: RemoteRevisionFile;
	/** Runtime-only merged bytes produced during planning and shown in review. */
	resolvedContent?: Uint8Array;
	conflictCopyPath?: string;
	/** The review must ask whether deletion or the edited content wins. */
	decision?: {
		deletedOn: "local" | "remote";
		editedOn: "local" | "remote";
	};
}

export type SyncPlanMode = "normal" | "initialUpload" | "initialDownload" | "adoptRemote" | "adoptLocal";

export interface SyncPlan {
	mode: SyncPlanMode;
	baseRevisionId: string | null;
	remoteRevisionId: string | null;
	entries: SyncPlanEntry[];
	ignoreRulesChanged?: boolean;
}

export const SYNC_JOURNAL_FORMAT = "isomite-sync-journal-v1" as const;

export interface JournalOperation {
	type: "write" | "trash";
	path: string;
	contentHash?: string;
	expectedLocalHash?: string;
}

export interface SyncJournal {
	format: typeof SYNC_JOURNAL_FORMAT;
	phase: "prepared" | "committed";
	targetVaultId: string;
	targetRevisionId: string;
	targetGeneration: number;
	targetFiles: RemoteRevisionFile[];
	operations: JournalOperation[];
	createdAt: string;
}
