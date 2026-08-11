import { Notice, Plugin } from "obsidian";
import {
	DerivedKeys,
	exportRecoveryKey,
	importRecoveryKey,
} from "./src/crypto/crypto";
import {
	initializeOrVerifyEncryption,
	verifyRecoveryKey,
} from "./src/crypto/bucket-encryption";
import { obsidianR2Transport } from "./src/r2/obsidian-request";
import { R2Client, R2ConnectionResult } from "./src/r2/r2-client";
import { DEFAULT_SETTINGS, IsomiteSettings, IsomiteSettingTab } from "./src/settings";
import { decodeLocalBaseline, decodeLocalJournal, encodeLocalBaseline, encodeLocalJournal } from "./src/sync/local-state";
import { RevisionStore } from "./src/sync/revision-store";
import { createSyncPlan } from "./src/sync/sync-service";
import { ObsidianSyncVaultAdapter } from "./src/sync/vault-adapter";
import { SyncReviewModal } from "./src/sync/review-modal";
import { commitPreparedSync, prepareSync } from "./src/sync/executor";
import { resumeSyncJournal } from "./src/sync/journal";
import { createPairingCode, parsePairingCode } from "./src/sync/pairing";
import { createVaultZipBackup } from "./src/sync/backup";

export default class IsomitePlugin extends Plugin {
	settings: IsomiteSettings = { ...DEFAULT_SETTINGS };
	private cachedEncryptionKeys?: DerivedKeys;
	private syncBusy = false;
	private syncRescanQueued?: "manual" | "automatic";
	private saveSyncTimer?: number;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new IsomiteSettingTab(this.app, this));
		this.addCommand({
			id: "sync-review",
			name: "Review and sync vault",
			callback: () => void this.reviewAndSync(false),
		});
		this.registerEvent(this.app.vault.on("modify", () => this.scheduleSaveReview()));
		this.registerEvent(this.app.vault.on("create", () => this.scheduleSaveReview()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleSaveReview()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleSaveReview()));
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStartup) window.setTimeout(() => void this.reviewAndSync(true), 2_000);
		});
	}

	onunload(): void {
		if (this.saveSyncTimer !== undefined) window.clearTimeout(this.saveSyncTimer);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async testR2Connection(): Promise<R2ConnectionResult> {
		return this.createR2Client().testConnection();
	}

	async initializeOrVerifyEncryption(): Promise<void> {
		if (this.settings.importedRecoveryKey) {
			const keys = await importRecoveryKey(this.settings.importedRecoveryKey);
			await verifyRecoveryKey(this.createR2Client(), keys);
			this.cachedEncryptionKeys = keys;
			return;
		}
		this.cachedEncryptionKeys = await initializeOrVerifyEncryption(
			this.createR2Client(),
			this.settings.passphrase
		);
	}

	async copyRecoveryKey(): Promise<void> {
		await this.initializeOrVerifyEncryption();
		if (!this.cachedEncryptionKeys) throw new Error("Encryption keys are not available.");
		await navigator.clipboard.writeText(await exportRecoveryKey(this.cachedEncryptionKeys));
	}

	async copyPairingCode(): Promise<void> {
		if (!this.settings.vaultId || !this.settings.encryptedSyncBaseline) {
			throw new Error("Complete the first sync before pairing another device.");
		}
		await navigator.clipboard.writeText(
			createPairingCode({
				vaultId: this.settings.vaultId,
				endpoint: this.settings.endpoint,
				bucket: this.settings.bucket,
			})
		);
	}

	async importPairingCode(value: string): Promise<void> {
		if (this.settings.encryptedSyncBaseline || this.settings.encryptedSyncJournal) {
			throw new Error("Reset this device's existing sync state before importing another pairing code.");
		}
		const pairing = parsePairingCode(value);
		this.settings.endpoint = pairing.endpoint;
		this.settings.bucket = pairing.bucket;
		this.settings.vaultId = pairing.vaultId;
		this.clearCachedEncryptionKeys();
		await this.saveSettings();
	}

	async importAndVerifyRecoveryKey(value: string): Promise<void> {
		if (!value) throw new Error("Paste a recovery key first.");
		const keys = await importRecoveryKey(value);
		await verifyRecoveryKey(this.createR2Client(), keys);
		this.settings.importedRecoveryKey = value;
		this.cachedEncryptionKeys = keys;
		await this.saveSettings();
	}

	clearCachedEncryptionKeys(): void {
		this.cachedEncryptionKeys = undefined;
	}

	async reviewAndSync(automatic = false): Promise<void> {
		if (this.syncBusy) {
			if (!automatic || !this.syncRescanQueued) this.syncRescanQueued = automatic ? "automatic" : "manual";
			return;
		}
		this.syncBusy = true;
		try {
			await this.initializeOrVerifyEncryption();
			const keys = this.cachedEncryptionKeys;
			if (!keys) throw new Error("Encryption keys are not available.");
			const client = this.createR2Client();
			const store = new RevisionStore(client, keys);
			const vault = new ObsidianSyncVaultAdapter(this.app);
			const persistence = {
				save: async (journal: Parameters<typeof encodeLocalJournal>[1] | undefined) => {
					this.settings.encryptedSyncJournal = journal ? await encodeLocalJournal(keys, journal) : "";
					await this.saveSettings();
				},
			};
			if (this.settings.encryptedSyncJournal) {
				const journal = await decodeLocalJournal(keys, this.settings.encryptedSyncJournal);
				if (journal.phase === "prepared") {
					this.settings.encryptedSyncJournal = "";
					await this.saveSettings();
				} else {
					const baseline = await resumeSyncJournal(journal, vault, store, keys, persistence);
					this.settings.encryptedSyncBaseline = await encodeLocalBaseline(keys, baseline);
					this.settings.vaultId = baseline.vaultId;
					await this.saveSettings();
					new Notice("Isomite finished recovering the previously approved sync. Review again for newer changes.");
					return;
				}
			}
			const baseline = this.settings.encryptedSyncBaseline
				? await decodeLocalBaseline(keys, this.settings.encryptedSyncBaseline)
				: undefined;
			const remoteHead = await store.readHead();
			let adoptEstablishedRemote = false;
			let adoptLocalOverRemote = false;
			if (remoteHead && !baseline) {
				if (this.settings.vaultId === remoteHead.head.vaultId) {
					adoptEstablishedRemote = true;
				} else {
					throw new Error("Pair this device with the bucket before its first sync.");
				}
			}
			if (!remoteHead && !this.settings.vaultId) {
				this.settings.vaultId = `vault-${crypto.randomUUID()}`;
				await this.saveSettings();
			}
			const requestedIgnorePatterns = this.settings.ignorePatternsDirty
				? this.settings.customIgnorePatterns
				: undefined;
			const planned = await createSyncPlan({
				vault,
				store,
				keys,
				baseline,
				localVaultId: this.settings.vaultId,
				adoptEstablishedRemote,
				adoptLocalOverRemote,
				requestedIgnorePatterns,
				configDir: this.app.vault.configDir,
				readBase: async (_path, contentHash) => store.getBlob(contentHash),
			});
			const changes = planned.plan.entries.filter((entry) => entry.action !== "noop");
			const ignoreRulesChanged = requestedIgnorePatterns !== undefined &&
				JSON.stringify([...requestedIgnorePatterns].sort()) !== JSON.stringify([...planned.remoteIgnorePatterns].sort());
			planned.plan.ignoreRulesChanged = ignoreRulesChanged;
			if (!changes.length && !ignoreRulesChanged) {
				if (!automatic) new Notice("Isomite is up to date.");
				return;
			}
			if (automatic) {
				const changeCount = changes.length + (ignoreRulesChanged ? 1 : 0);
				new Notice(`Isomite found ${changeCount} pending change${changeCount === 1 ? "" : "s"}. Run “Review and sync vault” to inspect them.`);
				return;
			}
			const review = await new SyncReviewModal(this.app, planned.plan).openAndWait();
			if (!review.approved) return;
			if (planned.plan.mode === "initialUpload") {
				const archive = await createVaultZipBackup(vault, requestedIgnorePatterns ?? planned.remoteIgnorePatterns);
				await this.saveFirstSyncBackup(archive);
			}
			const prepared = await prepareSync({
				plan: planned.plan,
				vault,
				store,
				keys,
				vaultId: this.settings.vaultId,
				deviceId: this.settings.deviceId,
				remoteFiles: planned.remoteFiles,
				remoteIgnorePatterns: planned.remoteIgnorePatterns,
				remoteHead: planned.remoteHead,
				ignorePatterns: requestedIgnorePatterns ?? planned.remoteIgnorePatterns,
				decisions: review.decisions,
			});
			await commitPreparedSync(prepared, store, persistence, vault, keys, planned.remoteHead);
			const completedBaseline = await resumeSyncJournal(prepared.journal, vault, store, keys, persistence);
			this.settings.encryptedSyncBaseline = await encodeLocalBaseline(keys, completedBaseline);
			this.settings.vaultId = completedBaseline.vaultId;
			this.settings.ignorePatternsDirty = false;
			await this.saveSettings();
			const changeCount = changes.length + (ignoreRulesChanged ? 1 : 0);
			new Notice(`Isomite applied ${changeCount} reviewed change${changeCount === 1 ? "" : "s"}.`);
		} catch (error) {
			new Notice(`Isomite sync stopped: ${String(error)}`, 10_000);
		} finally {
			this.syncBusy = false;
			if (this.syncRescanQueued) {
				const queued = this.syncRescanQueued;
				this.syncRescanQueued = undefined;
				window.setTimeout(() => void this.reviewAndSync(queued === "automatic"), 0);
			}
		}
	}

	private async saveFirstSyncBackup(archive: Uint8Array): Promise<void> {
		const baseName = this.app.vault.getName().replace(/[^A-Za-z0-9._-]/g, "-") || "vault";
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const path = `.isomite-backups/${baseName}-before-first-sync-${stamp}.zip`;
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(".isomite-backups"))) await adapter.mkdir(".isomite-backups");
		await adapter.writeBinary(path, archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer);
		new Notice(`Created required first-sync backup: ${path}`, 10_000);
	}

	private scheduleSaveReview(): void {
		if (!this.settings.syncOnSave) return;
		if (this.saveSyncTimer !== undefined) window.clearTimeout(this.saveSyncTimer);
		this.saveSyncTimer = window.setTimeout(() => {
			this.saveSyncTimer = undefined;
			void this.reviewAndSync(true);
		}, 30_000);
	}

	private createR2Client(): R2Client {
		return new R2Client(
			{
				endpoint: this.settings.endpoint,
				bucket: this.settings.bucket,
				accessKeyId: this.settings.accessKeyId,
				secretAccessKey: this.settings.secretAccessKey,
			},
			obsidianR2Transport
		);
	}

	private async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<IsomiteSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
		if (!Array.isArray(this.settings.customIgnorePatterns)) this.settings.customIgnorePatterns = [];
		if (typeof this.settings.ignorePatternsDirty !== "boolean") this.settings.ignorePatternsDirty = false;
		let changed = false;
		if (!this.settings.deviceId) {
			this.settings.deviceId = `device-${crypto.randomUUID()}`;
			changed = true;
		}
		if (changed) await this.saveSettings();
	}
}
