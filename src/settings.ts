import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type IsomitePlugin from "../main";
import { parseR2Endpoint } from "./r2/endpoint";

export interface IsomiteSettings {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export const DEFAULT_SETTINGS: IsomiteSettings = {
	endpoint: "",
	bucket: "",
	accessKeyId: "",
	secretAccessKey: "",
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

		new Setting(containerEl)
			.setName("S3 API endpoint")
			.setDesc("Use https://<ACCOUNT_ID>.r2.cloudflarestorage.com. A URL ending in /<bucket> is also accepted.")
			.addText((text) => {
				text.setPlaceholder("https://<ACCOUNT_ID>.r2.cloudflarestorage.com");
				text.setValue(this.plugin.settings.endpoint);
				text.onChange(async (value) => {
					const parsed = parseR2Endpoint(value);
					if (parsed) {
						this.plugin.settings.endpoint = parsed.endpoint;
						if (parsed.bucket) this.plugin.settings.bucket = parsed.bucket;
					} else {
						this.plugin.settings.endpoint = value.trim();
					}
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Bucket")
			.setDesc("Use a dedicated private bucket for one vault.")
			.addText((text) => {
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
						const message = error instanceof Error ? error.message : String(error);
						new Notice(`R2 connection failed: ${message}`);
					} finally {
						button.setDisabled(false).setButtonText("Test connection");
					}
				});
			});
	}
}
