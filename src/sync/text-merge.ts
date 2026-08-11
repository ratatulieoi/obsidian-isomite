import { diff3Merge } from "node-diff3";

export type TextMergeResult = { status: "merged"; text: string } | { status: "conflict" };

/** Conservative line-based diff3. Any overlapping edit becomes keep-both. */
export function mergeText(base: string, local: string, remote: string): TextMergeResult {
	try {
		const baseParts = normalize(base);
		const localParts = normalize(local);
		const remoteParts = normalize(remote);
		const result = diff3Merge(localParts.lines, baseParts.lines, remoteParts.lines, {
			excludeFalseConflicts: true,
		});
		if (result.some((segment) => segment.conflict !== undefined)) return { status: "conflict" };

		const lines = result.flatMap((segment) => segment.ok ?? []);
		const trailingNewline = chooseTrailingNewline(baseParts, localParts, remoteParts);
		const text = lines.join("\n");
		return { status: "merged", text: trailingNewline ? `${text}\n` : text };
	} catch {
		return { status: "conflict" };
	}
}

function normalize(value: string): { lines: string[]; trailingNewline: boolean; text: string } {
	const text = value.replace(/\r\n?/g, "\n");
	const trailingNewline = text.endsWith("\n");
	if (!text) return { lines: [], trailingNewline: false, text };
	const lines = text.split("\n");
	if (trailingNewline) lines.pop();
	return { lines, trailingNewline, text };
}

function chooseTrailingNewline(
	base: ReturnType<typeof normalize>,
	local: ReturnType<typeof normalize>,
	remote: ReturnType<typeof normalize>
): boolean {
	if (local.trailingNewline === remote.trailingNewline) return local.trailingNewline;
	if (local.text === base.text) return remote.trailingNewline;
	if (remote.text === base.text) return local.trailingNewline;
	return local.trailingNewline || remote.trailingNewline;
}
