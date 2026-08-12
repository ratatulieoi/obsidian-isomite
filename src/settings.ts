import { App, Notice, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type IsomitePlugin from "../main";
import { parseR2Endpoint } from "./r2/endpoint";
import { validateIgnorePatterns } from "./sync/ignore";

export type SetupMode = "initialize" | "pair";

export interface IsomiteSettings {
	setupMode: SetupMode;
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	passphrase: string;
	importedRecoveryKey: string;
	encryptionVerified: boolean;
	deviceId: string;
	deviceName: string;
	vaultId: string;
	encryptedSyncBaseline: string;
	encryptedSyncJournal: string;
	customIgnorePatterns: string[];
	ignorePatternsDirty: boolean;
	syncOnStartup: boolean;
	syncOnSave: boolean;
}

export const DEFAULT_SETTINGS: IsomiteSettings = {
	setupMode: "initialize",
	endpoint: "",
	bucket: "",
	accessKeyId: "",
	secretAccessKey: "",
	passphrase: "",
	importedRecoveryKey: "",
	encryptionVerified: false,
	deviceId: "",
	deviceName: "",
	vaultId: "",
	encryptedSyncBaseline: "",
	encryptedSyncJournal: "",
	customIgnorePatterns: [],
	ignorePatternsDirty: false,
	syncOnStartup: false,
	syncOnSave: false,
};

export class IsomiteSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: IsomitePlugin
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		let pairingCode = "";
		return [
			{
				type: "group",
				heading: "Setup",
				items: [
					{
						name: "This device",
						desc: "Set up a bucket directly, or import a secret pairing code from another Isomite device.",
						control: {
							type: "dropdown",
							key: "setupMode",
							options: {
								initialize: "Initialize or connect to bucket",
								pair: "Pair to existing Isomite vault",
							},
						},
					},
				],
			},
			{
				type: "group",
				heading: "Pair to existing Isomite vault",
				visible: () => this.plugin.settings.setupMode === "pair",
				items: [
					{
						name: "Pairing code",
						desc: "Paste the secret pairing code copied from a connected Isomite device. Anyone with this code can access the synchronized vault.",
						render: (setting) => {
							setting.addTextArea((text) => {
								text.setPlaceholder("Paste secret pairing code");
								text.onChange((value) => (pairingCode = value.trim()));
							});
						},
					},
					{
						name: "Import pairing code",
						desc: "Verify the code against its existing R2 vault and configure this device.",
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Import and connect").setCta();
								button.onClick(async () => {
									button.setDisabled(true).setButtonText("Importing…");
									try {
										await this.plugin.importPairingCode(pairingCode);
										new Notice("Pairing code imported and verified. Name this device, then select Sync to download the vault.");
										this.update();
									} catch (error) {
										new Notice(`Pairing import failed: ${errorText(error)}`);
									} finally {
										button.setDisabled(false).setButtonText("Import and connect");
									}
								});
							});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Cloudflare R2",
				visible: () => this.plugin.settings.setupMode !== "pair",
				items: [
					{
						name: "S3 API endpoint",
						desc: "Use https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>. Including the bucket name fills the bucket field automatically.",
						aliases: ["Cloudflare R2 URL", "account endpoint"],
						render: (setting) => {
							setting.addText((text) => {
								text.setPlaceholder("https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>");
								text.setValue(this.plugin.settings.endpoint);
								text.onChange(async (value) => {
									const parsed = parseR2Endpoint(value);
									this.plugin.settings.endpoint = parsed?.endpoint ?? value.trim();
									if (parsed?.bucket) this.plugin.settings.bucket = parsed.bucket;
									this.plugin.settings.encryptionVerified = false;
									this.plugin.clearCachedEncryptionKeys();
									await this.plugin.saveSettings();
									if (parsed?.bucket) this.update();
								});
							});
						},
					},
					{
						name: "R2 bucket name",
						desc: "The exact bucket name shown under Cloudflare R2 → Buckets.",
						aliases: ["bucket"],
						control: { type: "text", key: "bucket", placeholder: "my-obsidian-vault" },
					},
					{
						name: "Access key ID",
						desc: "The Access Key ID from a bucket-scoped R2 API token with Object Read & Write permission.",
						aliases: ["R2 API token", "credentials"],
						control: { type: "text", key: "accessKeyId", placeholder: "R2 Access Key ID" },
					},
					{
						name: "Secret access key",
						desc: "The matching R2 Secret Access Key. Cloudflare shows it only when the token is created.",
						aliases: ["R2 secret", "credentials"],
						render: (setting) => {
							setting.addText((text) => {
								text.inputEl.type = "password";
								text.setPlaceholder("R2 Secret Access Key");
								text.setValue(this.plugin.settings.secretAccessKey);
								text.onChange(async (value) => {
									this.plugin.settings.secretAccessKey = value.trim();
									this.plugin.settings.encryptionVerified = false;
									this.plugin.clearCachedEncryptionKeys();
									await this.plugin.saveSettings();
								});
							});
						},
					},
					{
						name: "Test connection",
						desc: "Send a signed read-only ListObjectsV2 request without uploading, changing, or deleting anything.",
						aliases: ["R2 connection"],
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Test connection");
								button.onClick(async () => {
									button.setDisabled(true).setButtonText("Testing…");
									try {
										const result = await this.plugin.testR2Connection();
										new Notice(`Connected to R2. Bucket contains ${result.objectCount} object${result.objectCount === 1 ? "" : "s"}.`);
									} catch (error) {
										new Notice(`R2 connection failed: ${errorText(error)}`);
									} finally {
										button.setDisabled(false).setButtonText("Test connection");
									}
								});
							});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Vault encryption",
				visible: () => this.plugin.settings.setupMode !== "pair",
				items: [
					{
						name: encryptionStatusName(this.plugin.getEncryptionStatus()),
						desc: encryptionStatusDescription(this.plugin.getEncryptionStatus()),
					},
					{
						name: "Vault passphrase",
						desc: "Encrypts this vault before anything is sent to R2. Keep it somewhere safe.",
						aliases: ["password", "encryption key"],
						render: (setting) => {
							setting.addText((text) => {
								text.inputEl.type = "password";
								text.setPlaceholder("Use a long, unique passphrase");
								text.setValue(this.plugin.settings.passphrase);
								text.onChange(async (value) => {
									this.plugin.settings.passphrase = value;
									this.plugin.settings.encryptionVerified = false;
									this.plugin.clearCachedEncryptionKeys();
									await this.plugin.saveSettings();
								});
							});
						},
					},
					{
						name: "Verify vault encryption",
						desc: "Check that this device can unlock the vault. Sync stays disabled until this succeeds.",
						aliases: ["verify passphrase", "initialize bucket"],
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Verify encryption");
								button.onClick(async () => {
									button.setDisabled(true).setButtonText("Verifying…");
									try {
										await this.plugin.initializeOrVerifyEncryption();
										new Notice("Vault is encrypted and ready to sync.");
										this.update();
									} catch (error) {
										new Notice(`Encryption verification failed: ${errorText(error)}`);
									} finally {
										button.setDisabled(false).setButtonText("Verify encryption");
									}
								});
							});
						},
					},
					{
						name: "Recovery key",
						desc: "An emergency code that unlocks the vault if you forget the passphrase. Store it outside this vault.",
						aliases: ["backup encryption key"],
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Copy recovery key");
								button.onClick(async () => {
									try {
										await this.plugin.copyRecoveryKey();
										new Notice("Recovery key copied. Store it safely outside the vault.");
									} catch (error) {
										new Notice(`Recovery-key export failed: ${errorText(error)}`);
									}
								});
							});
						},
					},
					{
						name: "Recovery key in use",
						desc: "This device currently unlocks the vault with an imported recovery key.",
						visible: () => Boolean(this.plugin.settings.importedRecoveryKey),
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Clear recovery key");
								button.onClick(async () => {
									this.plugin.settings.importedRecoveryKey = "";
									this.plugin.settings.encryptionVerified = false;
									this.plugin.clearCachedEncryptionKeys();
									await this.plugin.saveSettings();
									this.update();
								});
							});
						},
					},
					{
						name: "Unlock with recovery key",
						desc: "Paste your emergency recovery code when the original passphrase is unavailable.",
						aliases: ["restore encryption key"],
						visible: () => !this.plugin.settings.importedRecoveryKey,
						render: (setting) => {
							let recoveryKey = "";
							setting
								.addText((text) => {
									text.setPlaceholder("<base64>.<base64>.<base64>");
									text.onChange((value) => (recoveryKey = value.trim()));
								})
								.addButton((button) => {
									button.setButtonText("Import");
									button.onClick(async () => {
										try {
											await this.plugin.importAndVerifyRecoveryKey(recoveryKey);
											new Notice("Recovery key imported and verified.");
											this.update();
										} catch (error) {
											new Notice(`Recovery-key import failed: ${errorText(error)}`);
										}
									});
								});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Synchronization",
				visible: () => this.plugin.settings.setupMode !== "pair",
				items: [
					{
						name: "Device name",
						desc: "Shown in sync history so you know which device saved each change.",
						control: { type: "text", key: "deviceName", placeholder: "My laptop" },
					},
					{
						name: "Pair another device",
						desc: "Copy a complete pairing code. Keep it secret and store it somewhere safe; anyone with the code can access this synchronized vault.",
						aliases: ["pairing code", "new device"],
						visible: () => Boolean(this.plugin.settings.vaultId && this.plugin.settings.encryptedSyncBaseline),
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Copy pairing code");
								button.onClick(async () => {
									try {
										await this.plugin.copyPairingCode();
										new Notice("Pairing code copied. Keep it secret and store it somewhere safe.", 10_000);
									} catch (error) {
										new Notice(`Pairing export failed: ${errorText(error)}`);
									}
								});
							});
						},
					},
					{
						name: "Sync now",
						desc: "Check this device and R2, show what changed, then sync after you confirm.",
						aliases: ["manual sync", "sync now"],
						render: (setting) => {
							setting.addButton((button) => {
								const busy = this.plugin.isSyncBusy();
								const ready = this.plugin.isSyncReady();
								button.setDisabled(busy || !ready).setButtonText(busy ? "Sync in progress…" : "Sync");
								if (!busy && ready) button.setCta();
								button.onClick(() => {
									if (this.plugin.isSyncBusy() || !this.plugin.isSyncReady()) return;
									void this.plugin.reviewAndSync().finally(() => this.update());
								});
							});
						},
					},
					{
						name: "Sync history",
						desc: "See when this vault changed and which device saved each revision.",
						visible: () => Boolean(this.plugin.settings.encryptedSyncBaseline),
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("View history").setDisabled(!this.plugin.isSyncReady());
								button.onClick(async () => {
									button.setDisabled(true).setButtonText("Loading…");
									try {
										await this.plugin.openSyncHistory();
									} catch (error) {
										new Notice(`Sync history failed: ${errorText(error)}`);
									} finally {
										button.setDisabled(!this.plugin.isSyncReady()).setButtonText("View history");
									}
								});
							});
						},
					},
					{
						name: "Global ignore patterns",
						desc: "One glob per line. Encrypted rules apply to every paired device after the sync is confirmed.",
						aliases: ["exclude files", "ignore folders", "glob"],
						control: {
							type: "textarea",
							key: "customIgnorePatternsText",
							placeholder: "Private/**\nArchive/*.zip",
							rows: 4,
							validate: (value) => {
								try {
									validateIgnorePatterns(value.split("\n"));
								} catch (error) {
									return errorText(error);
								}
							},
						},
					},
					{
						name: "Sync on startup",
						desc: "Check for changes after Obsidian starts. Changes are never applied automatically.",
						aliases: ["automatic sync"],
						control: { type: "toggle", key: "syncOnStartup" },
					},
					{
						name: "Sync after saves",
						desc: "Check quietly after 30 seconds without vault changes. Changes are never applied automatically.",
						aliases: ["save trigger", "automatic sync"],
						control: { type: "toggle", key: "syncOnSave" },
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		switch (key) {
			case "setupMode":
				return this.plugin.settings.setupMode;
			case "bucket":
				return this.plugin.settings.bucket;
			case "accessKeyId":
				return this.plugin.settings.accessKeyId;
			case "deviceName":
				return this.plugin.settings.deviceName;
			case "customIgnorePatternsText":
				return this.plugin.settings.customIgnorePatterns.join("\n");
			case "syncOnStartup":
				return this.plugin.settings.syncOnStartup;
			case "syncOnSave":
				return this.plugin.settings.syncOnSave;
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case "setupMode":
				if (value !== "initialize" && value !== "pair") return;
				this.plugin.settings.setupMode = value;
				if (value === "pair") {
					this.plugin.settings.encryptionVerified = false;
					this.plugin.clearCachedEncryptionKeys();
				}
				await this.plugin.saveSettings();
				this.update();
				return;
			case "bucket":
				this.plugin.settings.bucket = String(value).trim();
				this.plugin.settings.encryptionVerified = false;
				this.plugin.clearCachedEncryptionKeys();
				break;
			case "accessKeyId":
				this.plugin.settings.accessKeyId = String(value).trim();
				this.plugin.settings.encryptionVerified = false;
				this.plugin.clearCachedEncryptionKeys();
				break;
			case "deviceName": {
				const deviceName = String(value).trim();
				if (!deviceName || deviceName.length > 80) return;
				this.plugin.settings.deviceName = deviceName;
				break;
			}
			case "customIgnorePatternsText":
				this.plugin.settings.customIgnorePatterns = validateIgnorePatterns(String(value).split("\n"));
				this.plugin.settings.ignorePatternsDirty = true;
				break;
			case "syncOnStartup":
				this.plugin.settings.syncOnStartup = Boolean(value);
				break;
			case "syncOnSave":
				this.plugin.settings.syncOnSave = Boolean(value);
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
	}
}

function encryptionStatusName(status: "missing" | "unverified" | "encrypted"): string {
	switch (status) {
		case "missing": return "Encryption not set up";
		case "unverified": return "Encryption needs verification";
		case "encrypted": return "Vault is encrypted";
	}
}

function encryptionStatusDescription(status: "missing" | "unverified" | "encrypted"): string {
	switch (status) {
		case "missing": return "Add a vault passphrase below. Sync is disabled until encryption is ready.";
		case "unverified": return "Verify the passphrase or recovery key before syncing.";
		case "encrypted": return "This device can unlock the vault. Files, filenames, and sync history are encrypted before upload.";
	}
}

function errorText(error: unknown): string {
	return String(error);
}
