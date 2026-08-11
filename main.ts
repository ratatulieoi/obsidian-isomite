import { Plugin } from "obsidian";
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

export default class IsomitePlugin extends Plugin {
	settings: IsomiteSettings = { ...DEFAULT_SETTINGS };
	private cachedEncryptionKeys?: DerivedKeys;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new IsomiteSettingTab(this.app, this));
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
	}
}
