import { RemoteHead, SyncBaseline } from "./types";

export class PairingRequiredError extends Error {
	constructor() {
		super("This bucket already contains an Isomite vault. Pair this device before syncing.");
		this.name = "PairingRequiredError";
	}
}

export class VaultIdentityMismatchError extends Error {
	constructor() {
		super("This R2 bucket belongs to a different Isomite vault.");
		this.name = "VaultIdentityMismatchError";
	}
}

export class RemoteRollbackError extends Error {
	constructor() {
		super("R2 points to an older or divergent revision. Sync stopped for recovery.");
		this.name = "RemoteRollbackError";
	}
}

export function assertRemoteIdentity(localVaultId: string | undefined, remoteHead: RemoteHead | undefined): void {
	if (!remoteHead) return;
	if (!localVaultId) throw new PairingRequiredError();
	if (localVaultId !== remoteHead.vaultId) throw new VaultIdentityMismatchError();
}

export function assertRemoteDidNotRollback(baseline: SyncBaseline | undefined, remoteHead: RemoteHead | undefined): void {
	if (!baseline) return;
	if (!remoteHead) throw new RemoteRollbackError();
	if (remoteHead.generation < baseline.generation) throw new RemoteRollbackError();
	if (remoteHead.generation === baseline.generation && remoteHead.revisionId !== baseline.revisionId) {
		throw new RemoteRollbackError();
	}
}

export function assertNoUnexpectedBucketObjects(keys: string[]): void {
	const allowedBeforeFirstSync = new Set(["_isomite/encryption-v1.json"]);
	const unexpected = keys.filter((key) => !allowedBeforeFirstSync.has(key));
	if (unexpected.length > 0) {
		throw new Error("The bucket contains data not created by this Isomite vault. Use a dedicated empty bucket.");
	}
}
