import { Notice, Plugin, setIcon } from "obsidian";
import {
	DerivedKeys,
	exportRecoveryKey,
	importRecoveryKey,
} from "./src/crypto/crypto";
import {
	initializeOrVerifyEncryption,
	verifyPassphrase,
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
import { SyncCancelledError, SyncProgress } from "./src/sync/progress";
import { SyncHistoryModal } from "./src/sync/history-modal";

export default class IsomitePlugin extends Plugin {
	settings: IsomiteSettings = { ...DEFAULT_SETTINGS };
	private cachedEncryptionKeys?: DerivedKeys;
	private syncBusy = false;
	private syncRescanQueued?: "manual" | "automatic";
	private saveSyncTimer?: number;
	private syncRibbonEl?: HTMLElement;
	private syncProgressNotice?: Notice;
	private syncAbortController?: AbortController;
	private syncCanCancel = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new IsomiteSettingTab(this.app, this));
		this.syncRibbonEl = this.addRibbonIcon("refresh-cw", "Sync Isomite", () => {
			if (this.syncBusy) {
				if (this.syncCanCancel) {
					this.syncAbortController?.abort();
					this.updateSyncProgress({ percent: 75, stage: "Cancelling before commit" });
				} else {
					new Notice("Isomite has committed this sync and must finish applying it.");
				}
				return;
			}
			void this.reviewAndSync(false);
		});
		this.addCommand({
			id: "sync-review",
			name: "Sync vault",
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
		this.syncProgressNotice?.hide();
	}

	isSyncBusy(): boolean {
		return this.syncBusy;
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
			this.settings.encryptionVerified = true;
			await this.saveSettings();
			this.setSyncUiBusy(this.syncBusy);
			return;
		}
		this.cachedEncryptionKeys = await initializeOrVerifyEncryption(
			this.createR2Client(),
			this.settings.passphrase
		);
		this.settings.encryptionVerified = true;
		await this.saveSettings();
		this.setSyncUiBusy(this.syncBusy);
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
		if (!this.settings.accessKeyId || !this.settings.secretAccessKey) {
			throw new Error("R2 credentials are incomplete.");
		}
		await this.initializeOrVerifyEncryption();
		const encryption = this.settings.importedRecoveryKey
			? { type: "recoveryKey" as const, value: this.settings.importedRecoveryKey }
			: { type: "passphrase" as const, value: this.settings.passphrase };
		const pairingCode = createPairingCode({
			vaultId: this.settings.vaultId,
			endpoint: this.settings.endpoint,
			bucket: this.settings.bucket,
			accessKeyId: this.settings.accessKeyId,
			secretAccessKey: this.settings.secretAccessKey,
			encryption,
		});
		await navigator.clipboard.writeText(pairingCode);
	}

	async importPairingCode(value: string): Promise<void> {
		if (this.settings.encryptedSyncBaseline || this.settings.encryptedSyncJournal) {
			throw new Error("This device already has sync state and cannot import a pairing code.");
		}
		const pairing = parsePairingCode(value);
		const previous = { ...this.settings };
		this.settings.endpoint = pairing.endpoint;
		this.settings.bucket = pairing.bucket;
		this.settings.accessKeyId = pairing.accessKeyId;
		this.settings.secretAccessKey = pairing.secretAccessKey;
		this.settings.vaultId = pairing.vaultId;
		this.settings.passphrase = pairing.encryption.type === "passphrase" ? pairing.encryption.value : "";
		this.settings.importedRecoveryKey = pairing.encryption.type === "recoveryKey" ? pairing.encryption.value : "";
		this.clearCachedEncryptionKeys();
		try {
			const connection = await this.testR2Connection();
			if (connection.objectCount === 0) throw new Error("The pairing bucket is empty.");
			const client = this.createR2Client();
			let keys: DerivedKeys;
			if (pairing.encryption.type === "recoveryKey") {
				keys = await importRecoveryKey(pairing.encryption.value);
				await verifyRecoveryKey(client, keys);
			} else {
				keys = await verifyPassphrase(client, pairing.encryption.value);
			}
			this.cachedEncryptionKeys = keys;
			const remoteHead = await new RevisionStore(this.createR2Client(), keys).readHead();
			if (!remoteHead || remoteHead.head.vaultId !== pairing.vaultId) {
				throw new Error("The pairing code does not match the Isomite vault in R2.");
			}
			this.settings.setupMode = "initialize";
			this.settings.encryptionVerified = true;
			await this.saveSettings();
		} catch (error) {
			this.cachedEncryptionKeys = undefined;
			this.settings = previous;
			this.setSyncUiBusy(this.syncBusy);
			throw error;
		}
	}

	async importAndVerifyRecoveryKey(value: string): Promise<void> {
		if (!value) throw new Error("Paste a recovery key first.");
		const keys = await importRecoveryKey(value);
		await verifyRecoveryKey(this.createR2Client(), keys);
		this.settings.importedRecoveryKey = value;
		this.cachedEncryptionKeys = keys;
		this.settings.encryptionVerified = true;
		await this.saveSettings();
		this.setSyncUiBusy(this.syncBusy);
	}

	clearCachedEncryptionKeys(): void {
		this.cachedEncryptionKeys = undefined;
		this.settings.encryptionVerified = false;
		this.setSyncUiBusy(this.syncBusy);
	}

	isSyncReady(): boolean {
		return this.settings.setupMode !== "pair" && this.hasConnectionSettings() && this.settings.encryptionVerified;
	}

	getEncryptionStatus(): "missing" | "unverified" | "encrypted" {
		if (this.settings.encryptionVerified) return "encrypted";
		return this.settings.passphrase || this.settings.importedRecoveryKey ? "unverified" : "missing";
	}

	async openSyncHistory(): Promise<void> {
		if (!this.isSyncReady()) throw new Error("Complete R2 setup and verify vault encryption first.");
		await this.initializeOrVerifyEncryption();
		const keys = this.cachedEncryptionKeys;
		if (!keys) throw new Error("Vault encryption is not unlocked.");
		const store = new RevisionStore(this.createR2Client(), keys);
		const head = await store.readHead();
		if (!head) throw new Error("Sync once before viewing history.");
		new SyncHistoryModal(this.app, head.head, store).open();
	}

	async reviewAndSync(automatic = false): Promise<void> {
		if (!this.isSyncReady()) {
			if (!automatic) new Notice("Complete R2 setup and verify vault encryption before syncing.");
			return;
		}
		if (this.syncBusy) {
			if (!automatic) new Notice("Isomite sync is already in progress.");
			else if (!this.syncRescanQueued) this.syncRescanQueued = "automatic";
			return;
		}
		this.syncBusy = true;
		this.syncAbortController = new AbortController();
		this.syncCanCancel = true;
		this.setSyncUiBusy(true);
		this.updateSyncProgress({ percent: 1, stage: "Starting sync" });
		try {
			this.updateSyncProgress({ percent: 5, stage: "Verifying encryption" });
			await this.initializeOrVerifyEncryption();
			const keys = this.cachedEncryptionKeys;
			if (!keys) throw new Error("Encryption keys are not available.");
			const client = this.createR2Client();
			const store = new RevisionStore(client, keys);
			this.updateSyncProgress({ percent: 10, stage: "Reading sync state" });
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
					this.updateSyncProgress({ percent: 85, stage: "Finishing previously committed sync" });
					const baseline = await resumeSyncJournal(
						journal,
						vault,
						store,
						keys,
						persistence,
						(progress) => this.updateSyncProgress(progress)
					);
					this.settings.encryptedSyncBaseline = await encodeLocalBaseline(keys, baseline);
					this.settings.vaultId = baseline.vaultId;
					await this.saveSettings();
					this.finishSyncProgress("Isomite finished the interrupted sync. Select Sync again to check for newer changes.");
					return;
				}
			}
			const baseline = this.settings.encryptedSyncBaseline
				? await decodeLocalBaseline(keys, this.settings.encryptedSyncBaseline)
				: undefined;
			const remoteHead = await store.readHead();
			let adoptEstablishedRemote = false;
			const adoptLocalOverRemote = false;
			if (remoteHead && !baseline) {
				if (this.settings.vaultId === remoteHead.head.vaultId) {
					adoptEstablishedRemote = true;
				} else {
					throw new Error("Choose “Pair to existing Isomite vault” and import its pairing code.");
				}
			}
			if (!remoteHead) {
				if (!baseline) this.settings.vaultId = `vault-${crypto.randomUUID()}`;
				await this.saveSettings();
			}
			const requestedIgnorePatterns = this.settings.ignorePatternsDirty
				? this.settings.customIgnorePatterns
				: undefined;
			this.updateSyncProgress({ percent: 15, stage: "Scanning local and R2 files" });
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
				onProgress: (progress) => this.updateSyncProgress(progress),
				signal: this.syncAbortController.signal,
			});
			if (this.syncAbortController.signal.aborted) throw new SyncCancelledError();
			this.updateSyncProgress({ percent: 30, stage: "Sync plan ready" });
			const changes = planned.plan.entries.filter((entry) => entry.action !== "noop");
			const ignoreRulesChanged = requestedIgnorePatterns !== undefined &&
				JSON.stringify([...requestedIgnorePatterns].sort()) !== JSON.stringify([...planned.remoteIgnorePatterns].sort());
			planned.plan.ignoreRulesChanged = ignoreRulesChanged;
			if (!changes.length && !ignoreRulesChanged) {
				this.finishSyncProgress("Isomite is up to date.");
				return;
			}
			if (automatic) {
				const changeCount = changes.length + (ignoreRulesChanged ? 1 : 0);
				this.finishSyncProgress(`Isomite found ${changeCount} pending change${changeCount === 1 ? "" : "s"}. Select the ribbon Sync button to continue.`);
				return;
			}
			this.updateSyncProgress({ percent: 30, stage: "Waiting for confirmation" });
			const review = await new SyncReviewModal(this.app, planned.plan).openAndWait();
			if (this.syncAbortController.signal.aborted) throw new SyncCancelledError();
			if (!review.approved) {
				this.finishSyncProgress("Isomite sync cancelled. No changes were applied.");
				return;
			}
			if (planned.plan.mode === "initialUpload") {
				this.updateSyncProgress({ percent: 30, stage: "Creating first-sync backup" });
				const archive = await createVaultZipBackup(
					vault,
					requestedIgnorePatterns ?? planned.remoteIgnorePatterns,
					(progress) => this.updateSyncProgress(progress),
					this.syncAbortController.signal
				);
				await this.saveFirstSyncBackup(archive);
			}
			if (this.syncAbortController.signal.aborted) throw new SyncCancelledError();
			this.updateSyncProgress({ percent: 35, stage: "Preparing confirmed changes" });
			const prepared = await prepareSync({
				plan: planned.plan,
				vault,
				store,
				keys,
				vaultId: this.settings.vaultId,
				deviceId: this.settings.deviceId,
				deviceName: this.settings.deviceName,
				remoteFiles: planned.remoteFiles,
				remoteIgnorePatterns: planned.remoteIgnorePatterns,
				remoteHead: planned.remoteHead,
				ignorePatterns: requestedIgnorePatterns ?? planned.remoteIgnorePatterns,
				decisions: review.decisions,
				onProgress: (progress) => this.updateSyncProgress(progress),
				signal: this.syncAbortController.signal,
			});
			this.syncCanCancel = false;
			this.setSyncUiBusy(true);
			this.updateSyncProgress({ percent: 78, stage: "Committing sync; do not close Obsidian" });
			await commitPreparedSync(prepared, store, persistence, vault, keys, planned.remoteHead);
			this.updateSyncProgress({ percent: 85, stage: "Applying committed local changes" });
			const completedBaseline = await resumeSyncJournal(
				prepared.journal,
				vault,
				store,
				keys,
				persistence,
				(progress) => this.updateSyncProgress(progress)
			);
			this.settings.encryptedSyncBaseline = await encodeLocalBaseline(keys, completedBaseline);
			this.settings.vaultId = completedBaseline.vaultId;
			this.settings.ignorePatternsDirty = false;
			await this.saveSettings();
			const changeCount = changes.length + (ignoreRulesChanged ? 1 : 0);
			this.finishSyncProgress(`Isomite sync complete. Applied ${changeCount} change${changeCount === 1 ? "" : "s"}.`);
		} catch (error) {
			if (error instanceof SyncCancelledError) {
				this.finishSyncProgress("Isomite sync cancelled before commit. No changes were applied.");
			} else {
				this.finishSyncProgress(`Isomite sync failed: ${String(error)}`, 10_000);
			}
		} finally {
			this.syncBusy = false;
			this.syncCanCancel = false;
			this.syncAbortController = undefined;
			this.setSyncUiBusy(false);
			if (this.syncRescanQueued) {
				const queued = this.syncRescanQueued;
				this.syncRescanQueued = undefined;
				window.setTimeout(() => void this.reviewAndSync(queued === "automatic"), 0);
			}
		}
	}

	private setSyncUiBusy(busy: boolean): void {
		if (!this.syncRibbonEl) return;
		const disabled = (!busy && !this.isSyncReady()) || (busy && !this.syncCanCancel);
		this.syncRibbonEl.toggleClass("is-disabled", disabled);
		this.syncRibbonEl.setAttribute("aria-disabled", String(disabled));
		this.syncRibbonEl.setAttribute(
			"aria-label",
			!busy && !this.isSyncReady()
				? "Complete R2 setup and verify vault encryption before syncing"
				: !busy
					? "Sync Isomite"
					: this.syncCanCancel
						? "Cancel Isomite sync before commit"
						: "Isomite sync committed; finishing"
		);
		setIcon(this.syncRibbonEl, !busy ? "refresh-cw" : this.syncCanCancel ? "square" : "loader-circle");
	}

	private updateSyncProgress(progress: SyncProgress): void {
		const message = `Isomite sync ${progress.percent}% — ${progress.stage}`;
		if (this.syncProgressNotice) this.syncProgressNotice.setMessage(message);
		else this.syncProgressNotice = new Notice(message, 0);
		this.syncProgressNotice.containerEl.setAttribute("role", "progressbar");
		this.syncProgressNotice.containerEl.setAttribute("aria-valuemin", "0");
		this.syncProgressNotice.containerEl.setAttribute("aria-valuemax", "100");
		this.syncProgressNotice.containerEl.setAttribute("aria-valuenow", String(progress.percent));
	}

	private finishSyncProgress(stage: string, duration = 6_000): void {
		this.syncProgressNotice?.hide();
		this.syncProgressNotice = undefined;
		new Notice(stage, duration);
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

	private hasConnectionSettings(): boolean {
		return Boolean(
			this.settings.endpoint &&
			this.settings.bucket &&
			this.settings.accessKeyId &&
			this.settings.secretAccessKey
		);
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
		if (typeof this.settings.deviceName !== "string") this.settings.deviceName = "";
		if (typeof this.settings.encryptionVerified !== "boolean") this.settings.encryptionVerified = false;
		if (typeof this.settings.ignorePatternsDirty !== "boolean") this.settings.ignorePatternsDirty = false;
		if (this.settings.setupMode !== "initialize" && this.settings.setupMode !== "pair") this.settings.setupMode = "initialize";
		let changed = false;
		if (!this.settings.deviceId) {
			this.settings.deviceId = `device-${crypto.randomUUID()}`;
			changed = true;
		}
		if (!this.settings.deviceName.trim()) {
			this.settings.deviceName = "My device";
			changed = true;
		}
		if (changed) await this.saveSettings();
	}
}
