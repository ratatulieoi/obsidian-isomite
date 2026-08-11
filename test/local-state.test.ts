import { describe, expect, it } from "vitest";
import { deriveKeys, generateSaltBase64 } from "../src/crypto/crypto";
import {
	decodeLocalBaseline,
	decodeLocalJournal,
	encodeLocalBaseline,
	encodeLocalJournal,
} from "../src/sync/local-state";
import { SYNC_BASELINE_FORMAT, SYNC_JOURNAL_FORMAT, SyncBaseline, SyncJournal } from "../src/sync/types";

const HASH = "ab".repeat(32);

describe("encrypted local sync state", () => {
	it("round-trips the baseline without readable vault paths", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const baseline: SyncBaseline = {
			format: SYNC_BASELINE_FORMAT,
			vaultId: "vault-12345678",
			revisionId: "revision-12345678",
			generation: 1,
			files: [{ path: "Private/Note.md", contentHash: HASH, size: 4, mtime: 1 }],
		};

		const encrypted = await encodeLocalBaseline(keys, baseline);

		expect(encrypted).not.toContain("Private");
		expect(await decodeLocalBaseline(keys, encrypted)).toEqual(baseline);
	});

	it("round-trips a crash journal", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const journal: SyncJournal = {
			format: SYNC_JOURNAL_FORMAT,
			phase: "committed",
			targetVaultId: "vault-12345678",
			targetRevisionId: "revision-12345678",
			targetGeneration: 1,
			targetFiles: [{ path: "Note.md", contentHash: HASH, size: 4 }],
			operations: [{ type: "write", path: "Note.md", contentHash: HASH }],
			createdAt: "2026-08-01T00:00:00.000Z",
		};

		expect(await decodeLocalJournal(keys, await encodeLocalJournal(keys, journal))).toEqual(journal);
	});
});
