import { escape, minimatch } from "minimatch";

const FIXED_IGNORE_PATTERNS = [
	".git/**",
	".trash/**",
	".isomite-backups/**",
] as const;

export function isIgnoredPath(path: string, customPatterns: string[], configDir: string): boolean {
	const normalized = normalizePath(path);
	return [...fixedIgnorePatterns(configDir), ...customPatterns].some((pattern) =>
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

function fixedIgnorePatterns(configDir: string): string[] {
	const escapedConfigDir = escape(normalizePath(configDir));
	return [
		...FIXED_IGNORE_PATTERNS,
		`${escapedConfigDir}/workspace*.json`,
		`${escapedConfigDir}/plugins/isomite/**`,
	];
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").normalize("NFC").replace(/^\/+/, "");
}

function normalizePattern(pattern: string): string {
	return pattern.replace(/\\/g, "/").normalize("NFC");
}
