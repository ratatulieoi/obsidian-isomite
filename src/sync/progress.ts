export interface SyncProgress {
	percent: number;
	stage: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export class SyncCancelledError extends Error {
	constructor() {
		super("Sync cancelled before commit.");
		this.name = "SyncCancelledError";
	}
}

export function reportProgress(
	callback: SyncProgressCallback | undefined,
	percent: number,
	stage: string
): void {
	callback?.({ percent: Math.max(0, Math.min(100, Math.round(percent))), stage });
}
