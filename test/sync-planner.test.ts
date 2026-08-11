import { describe, expect, it } from "vitest";
import { buildSyncPlan } from "../src/sync/planner";
import { SyncBaseline, SYNC_BASELINE_FORMAT } from "../src/sync/types";

const hash = (value: string): string => value.repeat(64).slice(0, 64);
const local = (path: string, content: string) => ({ path, contentHash: hash(content), size: content.length, mtime: 1 });
const remote = (path: string, content: string) => ({ path, contentHash: hash(content), size: content.length });

function baseline(files: Array<ReturnType<typeof local>>): SyncBaseline {
	return {
		format: SYNC_BASELINE_FORMAT,
		vaultId: "vault-12345678",
		revisionId: "revision-12345678",
		generation: 1,
		files,
	};
}

describe("buildSyncPlan", () => {
	it("plans a full upload into an empty bucket", () => {
		const plan = buildSyncPlan({
			localFiles: [local("B.md", "b"), local("A.md", "a")],
			remoteFiles: [],
			remoteRevisionId: null,
		});

		expect(plan.mode).toBe("initialUpload");
		expect(plan.entries.map(({ path, action }) => ({ path, action }))).toEqual([
			{ path: "A.md", action: "upload" },
			{ path: "B.md", action: "upload" },
		]);
	});

	it("plans a full download onto an empty device", () => {
		const plan = buildSyncPlan({
			localFiles: [],
			remoteFiles: [remote("A.md", "a")],
			remoteRevisionId: "revision-12345678",
		});

		expect(plan.mode).toBe("initialDownload");
		expect(plan.entries[0].action).toBe("download");
	});

	it("makes an established bucket authoritative during explicit pairing adoption", () => {
		const plan = buildSyncPlan({
			localFiles: [local("Clash.md", "l"), local("Local only.md", "x")],
			remoteFiles: [remote("Clash.md", "r")],
			remoteRevisionId: "revision-12345678",
			adoptEstablishedRemote: true,
		});

		expect(plan.mode).toBe("adoptRemote");
		expect(plan.entries.map(({ path, action }) => ({ path, action }))).toEqual([
			{ path: "Clash.md", action: "download" },
			{ path: "Local only.md", action: "upload" },
		]);
	});

	it("uploads and downloads one-sided edits", () => {
		const base = baseline([local("Local.md", "a"), local("Remote.md", "a")]);
		const plan = buildSyncPlan({
			baseline: base,
			localFiles: [local("Local.md", "b"), local("Remote.md", "a")],
			remoteFiles: [remote("Local.md", "a"), remote("Remote.md", "c")],
			remoteRevisionId: "revision-22222222",
		});

		expect(plan.entries.map(({ path, action }) => ({ path, action }))).toEqual([
			{ path: "Local.md", action: "upload" },
			{ path: "Remote.md", action: "download" },
		]);
	});

	it("requests a safe text merge but keeps both binary versions", () => {
		const base = baseline([local("Note.md", "a"), local("Photo.png", "a")]);
		const plan = buildSyncPlan({
			baseline: base,
			localFiles: [local("Note.md", "b"), local("Photo.png", "b")],
			remoteFiles: [remote("Note.md", "c"), remote("Photo.png", "c")],
			remoteRevisionId: "revision-22222222",
		});

		expect(plan.entries.map(({ path, action }) => ({ path, action }))).toEqual([
			{ path: "Note.md", action: "mergeText" },
			{ path: "Photo.png", action: "keepBoth" },
		]);
	});

	it("propagates deletion when the surviving side is unchanged", () => {
		const base = baseline([local("Local delete.md", "a"), local("Remote delete.md", "a")]);
		const plan = buildSyncPlan({
			baseline: base,
			localFiles: [local("Remote delete.md", "a")],
			remoteFiles: [remote("Local delete.md", "a")],
			remoteRevisionId: "revision-22222222",
		});

		expect(plan.entries.map(({ path, action }) => ({ path, action }))).toEqual([
			{ path: "Local delete.md", action: "deleteRemote" },
			{ path: "Remote delete.md", action: "deleteLocal" },
		]);
	});

	it("requires a choice whenever deletion races an edit", () => {
		const base = baseline([local("Local delete.md", "a"), local("Remote delete.md", "a")]);
		const plan = buildSyncPlan({
			baseline: base,
			localFiles: [local("Remote delete.md", "b")],
			remoteFiles: [remote("Local delete.md", "c")],
			remoteRevisionId: "revision-22222222",
		});

		expect(plan.entries.map(({ path, action, decision }) => ({ path, action, decision }))).toEqual([
			{
				path: "Local delete.md",
				action: "chooseDeleteOrEdit",
				decision: { deletedOn: "local", editedOn: "remote" },
			},
			{
				path: "Remote delete.md",
				action: "chooseDeleteOrEdit",
				decision: { deletedOn: "remote", editedOn: "local" },
			},
		]);
	});

	it("preserves both independently created versions after pairing", () => {
		const plan = buildSyncPlan({
			baseline: baseline([]),
			localFiles: [local("New.md", "a")],
			remoteFiles: [remote("New.md", "b")],
			remoteRevisionId: "revision-22222222",
		});

		expect(plan.entries[0].action).toBe("keepBoth");
		expect(plan.entries[0].reason).toBe("sameNewPath");
	});

	it("rejects duplicate normalized paths", () => {
		expect(() =>
			buildSyncPlan({
				localFiles: [local("Café.md", "a"), local("Cafe\u0301.md", "b")],
				remoteFiles: [],
				remoteRevisionId: null,
			})
		).toThrow("duplicate path");
	});
});
