export const HISTORY_RETENTION_DAYS = 30;
export const HISTORY_MIN_REVISIONS = 20;
export const HISTORY_GC_GRACE_DAYS = 7;

export function retainedRevisionIds(
	historyNewestFirst: Array<{ revisionId: string; createdAt: string }>,
	now: Date = new Date(),
	retentionDays = HISTORY_RETENTION_DAYS,
	minimum = HISTORY_MIN_REVISIONS
): Set<string> {
	const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
	return new Set(
		historyNewestFirst
			.filter((revision, index) => index < minimum || Date.parse(revision.createdAt) >= cutoff)
			.map((revision) => revision.revisionId)
	);
}
