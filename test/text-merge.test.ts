import { describe, expect, it } from "vitest";
import { mergeText } from "../src/sync/text-merge";

describe("mergeText", () => {
	it("merges independent line edits", () => {
		const base = "title\nfirst\nsecond\n";
		const local = "new title\nfirst\nsecond\n";
		const remote = "title\nfirst\nnew second\n";

		expect(mergeText(base, local, remote)).toEqual({
			status: "merged",
			text: "new title\nfirst\nnew second\n",
		});
	});

	it("rejects overlapping edits", () => {
		expect(mergeText("one\ntwo\n", "one\nlocal\n", "one\nremote\n")).toEqual({ status: "conflict" });
	});

	it("accepts identical changes from both devices", () => {
		expect(mergeText("old\n", "new\n", "new\n")).toEqual({ status: "merged", text: "new\n" });
	});

	it("normalizes line endings", () => {
		expect(
			mergeText(
				"first\r\nstable\r\nlast\r\n",
				"first\r\nstable\r\nlocal\r\n",
				"remote\r\nstable\r\nlast\r\n"
			)
		).toEqual({
			status: "merged",
			text: "remote\nstable\nlocal\n",
		});
	});
});
