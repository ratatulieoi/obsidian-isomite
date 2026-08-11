import { DerivedKeys } from "../crypto/crypto";
import { buildSyncPlan } from "./planner";
import { resolvePlanMerges } from "./plan-resolver";
import { RevisionStore, StoredHead } from "./revision-store";
import { scanLocalFiles } from "./scanner";
import { SyncBaseline, SyncPlan } from "./types";
import { SyncVaultAdapter } from "./vault-adapter";
import { assertRemoteDidNotRollback, assertRemoteIdentity } from "./guards";
import { isIgnoredPath } from "./ignore";

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
	readBase?: (path: string, contentHash: string) => Promise<Uint8Array | undefined>;
}

/** Read-only scan used by manual/startup/save triggers. */
export async function createSyncPlan(input: CreatePlanInput): Promise<PlannedSync> {
	const remoteHead = await input.store.readHead();
	assertRemoteIdentity(input.localVaultId, remoteHead?.head);
	assertRemoteDidNotRollback(input.baseline, remoteHead?.head);

	const remoteRevision = remoteHead ? await input.store.readRevision(remoteHead.head.revisionId) : undefined;
	if (remoteHead && remoteRevision?.vaultId !== remoteHead.head.vaultId) {
		throw new Error("The encrypted remote revision belongs to another vault.");
	}
	const remoteIgnorePatterns = remoteRevision?.ignorePatterns ?? [];
	const ignorePatterns = input.requestedIgnorePatterns ?? remoteIgnorePatterns;
	const localFiles = await scanLocalFiles(input.vault, input.keys, input.baseline, ignorePatterns);
	const ignoredRemotePaths = (remoteRevision?.files ?? [])
		.filter((file) => isIgnoredPath(file.path, ignorePatterns))
		.map((file) => file.path);
	let plan = buildSyncPlan({
		baseline: input.baseline,
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
	return {
		plan,
		remoteHead,
		remoteFiles: remoteRevision?.files ?? [],
		remoteIgnorePatterns,
	};
}
