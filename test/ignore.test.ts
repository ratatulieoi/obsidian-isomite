import { describe, expect, it } from "vitest";
import { isIgnoredPath, validateIgnorePatterns } from "../src/sync/ignore";

describe("sync ignores", () => {
	it("excludes fixed risky paths", () => {
		expect(isIgnoredPath(".git/objects/abc")).toBe(true);
		expect(isIgnoredPath(".trash/Old.md")).toBe(true);
		expect(isIgnoredPath(".obsidian/workspace-mobile.json")).toBe(true);
		expect(isIgnoredPath(".obsidian/plugins/isomite/data.json")).toBe(true);
		expect(isIgnoredPath(".isomite-backups/vault.zip")).toBe(true);
	});

	it("still includes Obsidian settings and other plugins", () => {
		expect(isIgnoredPath(".obsidian/app.json")).toBe(false);
		expect(isIgnoredPath(".obsidian/plugins/calendar/main.js")).toBe(false);
		expect(isIgnoredPath(".hidden-note.md")).toBe(false);
	});

	it("applies normalized global patterns", () => {
		const patterns = validateIgnorePatterns(["Private/**", "Private/**", "cache/*.bin"]);
		expect(patterns).toEqual(["Private/**", "cache/*.bin"]);
		expect(isIgnoredPath("Private/key.md", patterns)).toBe(true);
		expect(isIgnoredPath("Notes/key.md", patterns)).toBe(false);
	});

	it("rejects traversal patterns", () => {
		expect(() => validateIgnorePatterns(["../outside/**"])).toThrow("Unsafe ignore pattern");
	});
});
