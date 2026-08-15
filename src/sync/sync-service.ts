import { DerivedKeys } from "../crypto/crypto";
import { buildSyncPlan } from "./planner";
import { resolvePlanMerges } from "./plan-resolver";
import { RevisionStore, StoredHead } from "./revision-store";
import { scanLocalFiles } from "./scanner";
import { SyncBaseline, SyncPlan } from "./types";
import { SyncVaultAdapter } from "./vault-adapter";
import { assertRemoteDidNotRollback, assertRemoteIdentity, RemoteRollbackError } from "./guards";
import { isIgnoredPath } from "./ignore";
import { SyncProgressCallback } from "./progress";

export interface PlannedSync {
	plan: SyncPlan;
	remoteHead?: StoredHead;
	remoteFiles: Awaited<ReturnType<RevisionStore["readRevision"]>>["files"];
	remoteIgnorePatterns: string[];
}

export interface CreatePlanInput {
	vault: SyncVaultAdapter;
	store: RevisionStore;
	keys: DerivedKeys;
	baseline?: SyncBaseline;
	localVaultId?: string;
	adoptEstablishedRemote?: boolean;
	adoptLocalOverRemote?: boolean;
	requestedIgnorePatterns?: string[];
	configDir: string;
	readBase?: (path: string, contentHash: string) => Promise<Uint8Array | undefined>;
	onProgress?: SyncProgressCallback;
	signal?: AbortSignal;
}

/** Read-only scan used by manual/startup/save triggers. */
export async function createSyncPlan(input: CreatePlanInput): Promise<PlannedSync> {
	const remoteHead = await input.store.readHead();
	assertRemoteIdentity(input.localVaultId, remoteHead?.head);
	let baseline = input.baseline;
	let rebuildingSyncState = false;
	try {
		assertRemoteDidNotRollback(baseline, remoteHead?.head);
	} catch (error) {
		if (!(error instanceof RemoteRollbackError) || !remoteHead) throw error;
		// The local checkpoint can become stale after copying/restoring plugin
		// data or restoring R2. Compare current local and remote state from
		// scratch rather than trapping this device permanently.
		baseline = undefined;
		rebuildingSyncState = true;
	}

	const remoteRevision = remoteHead ? await input.store.readRevision(remoteHead.head.revisionId) : undefined;
	if (remoteHead && remoteRevision?.vaultId !== remoteHead.head.vaultId) {
		throw new Error("The encrypted remote revision belongs to another vault.");
	}
	const remoteIgnorePatterns = remoteRevision?.ignorePatterns ?? [];
	const ignorePatterns = input.requestedIgnorePatterns ?? remoteIgnorePatterns;
	const localFiles = await scanLocalFiles(
		input.vault,
		input.keys,
		baseline,
		ignorePatterns,
		input.onProgress,
		input.signal
	);
	const ignoredRemotePaths = (remoteRevision?.files ?? [])
		.filter((file) => isIgnoredPath(file.path, ignorePatterns, input.configDir))
		.map((file) => file.path);
	let plan = buildSyncPlan({
		baseline,
		localFiles,
		remoteFiles: remoteRevision?.files ?? [],
		remoteRevisionId: remoteHead?.head.revisionId ?? null,
		adoptEstablishedRemote: input.adoptEstablishedRemote,
		adoptLocalOverRemote: input.adoptLocalOverRemote,
		ignoredRemotePaths,
	});
	if (input.readBase) {
		plan = await resolvePlanMerges(plan, input.vault, input.store, input.readBase);
	}
	plan.rebuildingSyncState = rebuildingSyncState;
	return {
		plan,
		remoteHead,
		remoteFiles: remoteRevision?.files ?? [],
		remoteIgnorePatterns,
	};
}
