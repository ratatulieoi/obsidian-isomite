import { App, Modal, Setting } from "obsidian";
import { DeleteVsEditDecision } from "./executor";
import { SyncPlan, SyncPlanEntry } from "./types";

export interface SyncReviewResult {
	approved: boolean;
	decisions: DeleteVsEditDecision[];
}

export class SyncReviewModal extends Modal {
	private settled = false;
	private resolveResult?: (result: SyncReviewResult) => void;
	private decisions = new Map<string, "delete" | "edit">();

	constructor(app: App, private readonly plan: SyncPlan) {
		super(app);
	}

	openAndWait(): Promise<SyncReviewResult> {
		return new Promise((resolve) => {
			this.resolveResult = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.titleEl.setText("Confirm sync changes");
		const changed = this.plan.entries.filter((entry) => entry.action !== "noop");
		const totalChanges = changed.length + (this.plan.ignoreRulesChanged ? 1 : 0);
		this.contentEl.createEl("p", {
			text: `${totalChanges} change${totalChanges === 1 ? "" : "s"}. Check the list, then confirm to sync everything together.`,
		});
		if (this.plan.ignoreRulesChanged) {
			this.contentEl.createEl("p", { text: "Global ignore rules will also be updated for every paired device." });
		}

		const summary = summarize(changed);
		this.contentEl.createEl("p", { text: summary });
		const list = this.contentEl.createDiv({ cls: "isomite-sync-review-list" });
		for (const entry of changed) this.renderEntry(list, entry);

		const controls = new Setting(this.contentEl);
		controls.addButton((button) => {
			button.setButtonText("Cancel");
			button.onClick(() => this.finish(false));
		});
		controls.addButton((button) => {
			button.setButtonText("Confirm and sync").setCta();
			button.onClick(() => {
				const unresolved = changed.find(
					(entry) => entry.action === "chooseDeleteOrEdit" && !this.decisions.has(entry.path)
				);
				if (unresolved) {
					button.setTooltip(`Choose delete or edited version for ${unresolved.path}`);
					return;
				}
				this.finish(true);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.resolveResult?.({ approved: false, decisions: [] });
		}
	}

	private renderEntry(container: HTMLElement, entry: SyncPlanEntry): void {
		const details = container.createEl("details");
		const summary = details.createEl("summary");
		summary.createSpan({ text: `${labelFor(entry)} · ` });
		summary.createEl("code", { text: entry.path });
		const sizes = [entry.local?.size, entry.remote?.size].filter((value) => value !== undefined);
		details.createEl("p", { text: sizes.length ? `Size: ${sizes.join(" → ")} bytes` : "" });

		if (entry.resolvedContent) {
			const merged = new TextDecoder().decode(entry.resolvedContent);
			details.createEl("pre", { text: merged.length > 100_000 ? `${merged.slice(0, 100_000)}\n…` : merged });
		}
		if (entry.action === "chooseDeleteOrEdit") {
			new Setting(details)
				.setName("Deletion conflicts with an edit")
				.addDropdown((dropdown) => {
					dropdown.addOption("", "Choose…");
					dropdown.addOption("delete", "Delete the file");
					dropdown.addOption("edit", "Keep the edited version");
					dropdown.onChange((value) => {
						if (value === "delete" || value === "edit") this.decisions.set(entry.path, value);
						else this.decisions.delete(entry.path);
					});
				});
		}
	}

	private finish(approved: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolveResult?.({
			approved,
			decisions: [...this.decisions].map(([path, winner]) => ({ path, winner })),
		});
		this.close();
	}
}

function labelFor(entry: SyncPlanEntry): string {
	switch (entry.action) {
		case "upload": return "Upload";
		case "download": return "Download";
		case "deleteLocal": return "Delete locally";
		case "deleteRemote": return "Delete from R2";
		case "mergeText": return "Merge text";
		case "keepBoth": return "Keep both";
		case "chooseDeleteOrEdit": return "Decision required";
		case "noop": return "No change";
	}
}

function summarize(entries: SyncPlanEntry[]): string {
	const counts = new Map<string, number>();
	for (const entry of entries) counts.set(labelFor(entry), (counts.get(labelFor(entry)) ?? 0) + 1);
	return [...counts].map(([label, count]) => `${count} ${label.toLowerCase()}`).join(" · ");
}
