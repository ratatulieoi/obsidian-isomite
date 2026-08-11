import { minimatch } from "minimatch";

export const DEFAULT_IGNORE_PATTERNS = [
	".git/**",
	".trash/**",
	".obsidian/workspace*.json",
	".obsidian/plugins/isomite/**",
	".isomite-backups/**",
] as const;

export function isIgnoredPath(path: string, customPatterns: string[] = []): boolean {
	const normalized = normalizePath(path);
	return [...DEFAULT_IGNORE_PATTERNS, ...customPatterns].some((pattern) =>
		minimatch(normalized, normalizePattern(pattern), { dot: true, nocase: false, nocomment: true })
	);
}

export function validateIgnorePatterns(patterns: string[]): string[] {
	const unique = new Set<string>();
	for (const raw of patterns) {
		const pattern = normalizePattern(raw.trim());
		if (!pattern) continue;
		if (pattern.startsWith("/") || pattern.includes("..")) {
			throw new Error(`Unsafe ignore pattern: ${raw}`);
		}
		unique.add(pattern);
	}
	return [...unique].sort();
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").normalize("NFC").replace(/^\/+/, "");
}

function normalizePattern(pattern: string): string {
	return pattern.replace(/\\/g, "/").normalize("NFC");
}
