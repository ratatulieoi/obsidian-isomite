import { describe, expect, it } from "vitest";
import { resolvePlanMerges } from "../src/sync/plan-resolver";
import { RevisionStore } from "../src/sync/revision-store";
import { SyncPlan } from "../src/sync/types";
import { SyncVaultAdapter, VaultFileMeta } from "../src/sync/vault-adapter";

class OneFileVault implements SyncVaultAdapter {
	constructor(private readonly bytes: Uint8Array) {}
	async listFiles(): Promise<VaultFileMeta[]> { return []; }
	async readFile(): Promise<Uint8Array> { return this.bytes; }
	async writeFile(): Promise<void> {}
	async trashFile(): Promise<void> {}
	async stat(): Promise<VaultFileMeta | undefined> { return undefined; }
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("resolvePlanMerges", () => {
	it("attaches a safe merged result for review", async () => {
		const plan: SyncPlan = {
			mode: "normal",
			baseRevisionId: "revision-11111111",
			remoteRevisionId: "revision-22222222",
			entries: [{
				path: "Note.md",
				action: "mergeText",
				reason: "bothChanged",
				base: { path: "Note.md", contentHash: "11".repeat(32), size: 6 },
				local: { path: "Note.md", contentHash: "22".repeat(32), size: 12, mtime: 1 },
				remote: { path: "Note.md", contentHash: "33".repeat(32), size: 13 },
			}],
		};
		const store = { getBlob: async () => encode("a\nstable\nremote\n") } as unknown as RevisionStore;

		const resolved = await resolvePlanMerges(
			plan,
			new OneFileVault(encode("local\nstable\nc\n")),
			store,
			async () => encode("a\nstable\nc\n")
		);

		expect(new TextDecoder().decode(resolved.entries[0].resolvedContent)).toBe("local\nstable\nremote\n");
	});

	it("falls back to keep-both without an authenticated base", async () => {
		const plan: SyncPlan = {
			mode: "normal",
			baseRevisionId: "revision-11111111",
			remoteRevisionId: "revision-22222222",
			entries: [{
				path: "Note.md",
				action: "mergeText",
				reason: "bothChanged",
				base: { path: "Note.md", contentHash: "11".repeat(32), size: 1 },
				local: { path: "Note.md", contentHash: "22".repeat(32), size: 1, mtime: 1 },
				remote: { path: "Note.md", contentHash: "33".repeat(32), size: 1 },
			}],
		};
		const store = { getBlob: async () => encode("r") } as unknown as RevisionStore;

		const resolved = await resolvePlanMerges(plan, new OneFileVault(encode("l")), store, async () => undefined);

		expect(resolved.entries[0].action).toBe("keepBoth");
	});
});
