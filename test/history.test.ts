import { describe, expect, it } from "vitest";
import { retainedRevisionIds } from "../src/sync/retention";
import { REMOTE_REVISION_FORMAT, RemoteRevision } from "../src/sync/types";

function revision(index: number, createdAt: string): RemoteRevision {
	return {
		format: REMOTE_REVISION_FORMAT,
		vaultId: "vault-12345678",
		revisionId: `revision-${String(index).padStart(8, "0")}`,
		parentRevisionId: index > 1 ? `revision-${String(index - 1).padStart(8, "0")}` : null,
		generation: index,
		createdAt,
		deviceId: "device-12345678",
		files: [],
		ignorePatterns: [],
	};
}

describe("history retention", () => {
	it("keeps at least 20 revisions and every revision from 30 days", () => {
		const now = new Date("2026-08-31T00:00:00.000Z");
		const history = Array.from({ length: 25 }, (_, offset) => {
			const index = 25 - offset;
			const ageDays = offset < 3 ? offset : 60 + offset;
			return revision(index, new Date(now.getTime() - ageDays * 86_400_000).toISOString());
		});

		const retained = retainedRevisionIds(history, now);

		expect(retained.size).toBe(20);
		expect(retained.has("revision-00000025")).toBe(true);
		expect(retained.has("revision-00000006")).toBe(true);
		expect(retained.has("revision-00000005")).toBe(false);
	});

	it("keeps more than 20 when they are recent", () => {
		const now = new Date("2026-08-31T00:00:00.000Z");
		const history = Array.from({ length: 25 }, (_, offset) =>
			revision(25 - offset, new Date(now.getTime() - offset * 86_400_000).toISOString())
		);

		expect(retainedRevisionIds(history, now).size).toBe(25);
	});
});
