import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type IsomitePlugin from "../main";
import { parseR2Endpoint } from "./r2/endpoint";

export interface IsomiteSettings {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	passphrase: string;
	importedRecoveryKey: string;
}

export const DEFAULT_SETTINGS: IsomiteSettings = {
	endpoint: "",
	bucket: "",
	accessKeyId: "",
	secretAccessKey: "",
	passphrase: "",
	importedRecoveryKey: "",
};

export class IsomiteSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: IsomitePlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Cloudflare R2").setHeading();
		containerEl.createEl("p", {
			text: "Connect Isomite directly to a private R2 bucket. Credentials stay in this plugin's local data.json file and are never written into the bucket.",
		});

		let bucketInput: HTMLInputElement;
		new Setting(containerEl)
			.setName("S3 API endpoint")
			.setDesc("Use https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>. Including the bucket name fills the field below automatically.")
			.addText((text) => {
				text.setPlaceholder("https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>");
				text.setValue(this.plugin.settings.endpoint);
				text.onChange(async (value) => {
					const parsed = parseR2Endpoint(value);
					if (parsed) {
						this.plugin.settings.endpoint = parsed.endpoint;
						if (parsed.bucket) {
							this.plugin.settings.bucket = parsed.bucket;
							bucketInput.value = parsed.bucket;
						}
					} else {
						this.plugin.settings.endpoint = value.trim();
					}
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("R2 bucket name")
			.setDesc("The exact bucket name shown under Cloudflare R2 → Buckets.")
			.addText((text) => {
				bucketInput = text.inputEl;
				text.setPlaceholder("my-obsidian-vault");
				text.setValue(this.plugin.settings.bucket);
				text.onChange(async (value) => {
					this.plugin.settings.bucket = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Access key ID")
			.setDesc("The Access Key ID from a bucket-scoped R2 API token with Object Read & Write permission.")
			.addText((text) => {
				text.setPlaceholder("R2 Access Key ID");
				text.setValue(this.plugin.settings.accessKeyId);
				text.onChange(async (value) => {
					this.plugin.settings.accessKeyId = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Secret access key")
			.setDesc("The matching R2 Secret Access Key. Cloudflare shows it only when the token is created.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("R2 Secret Access Key");
				text.setValue(this.plugin.settings.secretAccessKey);
				text.onChange(async (value) => {
					this.plugin.settings.secretAccessKey = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Sends a signed read-only ListObjectsV2 request. It does not upload, change, or delete anything.")
			.addButton((button) => {
				button.setButtonText("Test connection");
				button.onClick(async () => {
					button.setDisabled(true).setButtonText("Testing…");
					try {
						const result = await this.plugin.testR2Connection();
						new Notice(`Connected to R2. Bucket contains ${result.objectCount} object${result.objectCount === 1 ? "" : "s"}.`);
					} catch (error) {
						new Notice(`R2 connection failed: ${errorMessage(error)}`);
					} finally {
						button.setDisabled(false).setButtonText("Test connection");
					}
				});
			});

		new Setting(containerEl).setName("Encryption").setHeading();
		containerEl.createEl("p", {
			text: "Isomite encrypts file contents with AES-256-GCM and hides paths with keyed hashes before future sync data reaches R2. Losing both the passphrase and recovery key makes encrypted data unrecoverable.",
		});

		new Setting(containerEl)
			.setName("Encryption passphrase")
			.setDesc("Stored locally so future startup and save-triggered sync can run unattended. Use the same passphrase on every device.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("Use a long, unique passphrase");
				text.setValue(this.plugin.settings.passphrase);
				text.onChange(async (value) => {
					this.plugin.settings.passphrase = value;
					this.plugin.clearCachedEncryptionKeys();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Initialize or verify encryption")
			.setDesc("Creates Isomite encryption metadata in an unused bucket, or verifies that this passphrase matches existing metadata. No vault files are uploaded.")
			.addButton((button) => {
				button.setButtonText("Verify encryption");
				button.onClick(async () => {
					button.setDisabled(true).setButtonText("Verifying…");
					try {
						await this.plugin.initializeOrVerifyEncryption();
						new Notice("Encryption is initialized and the passphrase matches this bucket.");
					} catch (error) {
						new Notice(`Encryption verification failed: ${errorMessage(error)}`);
					} finally {
						button.setDisabled(false).setButtonText("Verify encryption");
					}
				});
			});

		new Setting(containerEl)
			.setName("Export recovery key")
			.setDesc("Copies sensitive recovery key material. Store it in a password manager outside this vault.")
			.addButton((button) => {
				button.setButtonText("Copy recovery key");
				button.onClick(async () => {
					try {
						await this.plugin.copyRecoveryKey();
						new Notice("Recovery key copied. Store it safely outside the vault.");
					} catch (error) {
						new Notice(`Recovery-key export failed: ${errorMessage(error)}`);
					}
				});
			});

		if (this.plugin.settings.importedRecoveryKey) {
			new Setting(containerEl)
				.setName("Imported recovery key")
				.setDesc("An imported recovery key is stored locally and will take priority over the passphrase during future sync.")
				.addButton((button) => {
					button.setButtonText("Clear recovery key");
					button.onClick(async () => {
						this.plugin.settings.importedRecoveryKey = "";
						this.plugin.clearCachedEncryptionKeys();
						await this.plugin.saveSettings();
						this.display();
					});
				});
		} else {
			let recoveryKey = "";
			new Setting(containerEl)
				.setName("Import recovery key")
				.setDesc("Use a previously exported key if the passphrase is unavailable.")
				.addText((text) => {
					text.setPlaceholder("<base64>.<base64>.<base64>");
					text.onChange((value) => {
						recoveryKey = value.trim();
					});
				})
				.addButton((button) => {
					button.setButtonText("Import");
					button.onClick(async () => {
						try {
							await this.plugin.importAndVerifyRecoveryKey(recoveryKey);
							new Notice("Recovery key imported and verified.");
							this.display();
						} catch (error) {
							new Notice(`Recovery-key import failed: ${errorMessage(error)}`);
						}
					});
				});
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
