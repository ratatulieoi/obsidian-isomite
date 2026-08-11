import { describe, expect, it } from "vitest";
import { isIgnoredPath, validateIgnorePatterns } from "../src/sync/ignore";

const CONFIG_DIR = ".vault-config";
const ignored = (path: string, patterns: string[] = []) => isIgnoredPath(path, patterns, CONFIG_DIR);

describe("sync ignores", () => {
	it("excludes fixed risky paths", () => {
		expect(ignored(".git/objects/abc")).toBe(true);
		expect(ignored(".trash/Old.md")).toBe(true);
		expect(ignored(".vault-config/workspace-mobile.json")).toBe(true);
		expect(ignored(".vault-config/plugins/isomite/data.json")).toBe(true);
		expect(ignored(".isomite-backups/vault.zip")).toBe(true);
	});

	it("still includes Obsidian settings and other plugins", () => {
		expect(ignored(".vault-config/app.json")).toBe(false);
		expect(ignored(".vault-config/plugins/calendar/main.js")).toBe(false);
		expect(ignored(".hidden-note.md")).toBe(false);
	});

	it("applies normalized global patterns", () => {
		const patterns = validateIgnorePatterns(["Private/**", "Private/**", "cache/*.bin"]);
		expect(patterns).toEqual(["Private/**", "cache/*.bin"]);
		expect(ignored("Private/key.md", patterns)).toBe(true);
		expect(ignored("Notes/key.md", patterns)).toBe(false);
	});

	it("rejects traversal patterns", () => {
		expect(() => validateIgnorePatterns(["../outside/**"])).toThrow("Unsafe ignore pattern");
	});
});
