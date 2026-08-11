import { describe, expect, it } from "vitest";
import { findPathCollisions } from "../src/sync/path-guards";

describe("path collision guards", () => {
	it("finds case-insensitive collisions", () => {
		expect(findPathCollisions([{ path: "Note.md" }, { path: "note.md" }])).toContainEqual({
			type: "case",
			paths: ["Note.md", "note.md"],
		});
	});

	it("finds file/folder collisions", () => {
		expect(findPathCollisions([{ path: "Projects" }, { path: "Projects/Plan.md" }])).toContainEqual({
			type: "fileFolder",
			paths: ["Projects", "Projects/Plan.md"],
		});
	});

	it("accepts normal nested files", () => {
		expect(findPathCollisions([{ path: "Projects/A.md" }, { path: "Projects/B.md" }])).toEqual([]);
	});
});
