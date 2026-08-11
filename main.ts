import { Plugin } from "obsidian";
import { obsidianR2Transport } from "./src/r2/obsidian-request";
import { R2Client, R2ConnectionResult } from "./src/r2/r2-client";
import { DEFAULT_SETTINGS, IsomiteSettings, IsomiteSettingTab } from "./src/settings";

export default class IsomitePlugin extends Plugin {
	settings: IsomiteSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new IsomiteSettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async testR2Connection(): Promise<R2ConnectionResult> {
		const client = new R2Client(
			{
				endpoint: this.settings.endpoint,
				bucket: this.settings.bucket,
				accessKeyId: this.settings.accessKeyId,
				secretAccessKey: this.settings.secretAccessKey,
			},
			obsidianR2Transport
		);
		return client.testConnection();
	}

	private async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<IsomiteSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
	}
}
