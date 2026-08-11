import { describe, expect, it } from "vitest";
import {
	assertNoUnexpectedBucketObjects,
	assertRemoteDidNotRollback,
	assertRemoteIdentity,
	PairingRequiredError,
	RemoteRollbackError,
	VaultIdentityMismatchError,
} from "../src/sync/guards";
import { REMOTE_HEAD_FORMAT, SYNC_BASELINE_FORMAT } from "../src/sync/types";

const head = {
	format: REMOTE_HEAD_FORMAT,
	vaultId: "vault-12345678",
	revisionId: "revision-22222222",
	generation: 2,
	history: [{ revisionId: "revision-22222222", generation: 2, createdAt: "2026-08-01T00:00:00.000Z" }],
};

describe("sync safety guards", () => {
	it("requires pairing and blocks a different vault identity", () => {
		expect(() => assertRemoteIdentity(undefined, head)).toThrow(PairingRequiredError);
		expect(() => assertRemoteIdentity("vault-99999999", head)).toThrow(VaultIdentityMismatchError);
		expect(() => assertRemoteIdentity(head.vaultId, head)).not.toThrow();
	});

	it("blocks a suddenly empty, backward, or divergent remote history", () => {
		const baseline = {
			format: SYNC_BASELINE_FORMAT,
			vaultId: head.vaultId,
			revisionId: head.revisionId,
			generation: 2,
			files: [],
		};
		expect(() => assertRemoteDidNotRollback(baseline, undefined)).toThrow(RemoteRollbackError);
		expect(() => assertRemoteDidNotRollback(baseline, { ...head, generation: 1 })).toThrow(RemoteRollbackError);
		expect(() => assertRemoteDidNotRollback(baseline, { ...head, revisionId: "revision-33333333" })).toThrow(
			RemoteRollbackError
		);
	});

	it("requires a dedicated empty bucket before first sync", () => {
		expect(() => assertNoUnexpectedBucketObjects(["_isomite/encryption-v1.json"])).not.toThrow();
		expect(() => assertNoUnexpectedBucketObjects(["unrelated.txt"])).toThrow("dedicated empty bucket");
	});
});
