import { App, Modal } from "obsidian";
import { RevisionStore } from "./revision-store";
import { errorMessage } from "../util/error";
import { RemoteHead, RemoteRevision, RevisionChangeSummary } from "./types";

export class SyncHistoryModal extends Modal {
	constructor(
		app: App,
		private readonly head: RemoteHead,
		private readonly store: RevisionStore
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Sync history");
		this.contentEl.createEl("p", { text: "Recent changes saved to this encrypted vault." });
		this.contentEl.createEl("p", { text: "Loading history…" });
		void this.loadHistory();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async loadHistory(): Promise<void> {
		try {
			const revisions = await Promise.all(
				this.head.history.map((entry) => this.store.readRevision(entry.revisionId))
			);
			this.renderHistory(revisions);
		} catch (error) {
			this.contentEl.empty();
			this.contentEl.createEl("p", { text: `Could not load sync history: ${errorMessage(error)}` });
		}
	}

	private renderHistory(revisions: RemoteRevision[]): void {
		this.contentEl.empty();
		this.contentEl.createEl("p", { text: "Recent changes saved to this encrypted vault. History is view-only." });
		const list = this.contentEl.createDiv({ cls: "isomite-sync-history" });
		for (const revision of revisions) {
			const item = list.createDiv({ cls: "isomite-sync-history-item" });
			item.createEl("h3", { text: revision.deviceName ?? "Unnamed device" });
			item.createEl("p", { text: `${formatDate(revision.createdAt)} · Revision ${revision.generation}` });
			item.createEl("p", { text: formatChanges(revision.changes) });
		}
	}
}

function formatDate(value: string): string {
	return new Date(value).toLocaleString();
}

function formatChanges(changes: RevisionChangeSummary | undefined): string {
	if (!changes) return "Change details are unavailable for this older sync.";
	const parts = [
		[changes.added, "added"],
		[changes.updated, "updated"],
		[changes.deleted, "deleted"],
		[changes.conflicts, "conflict"],
	] as const;
	const visible = parts
		.filter(([count]) => count > 0)
		.map(([count, label]) => `${count} ${label}${label === "conflict" && count !== 1 ? "s" : ""}`);
	return visible.length ? visible.join(" · ") : "No file changes";
}
