import { describe, expect, it } from "vitest";
import { userErrorMessage } from "../src/util/error";

describe("user-facing errors", () => {
	it("explains credential and permission failures with a next step", () => {
		expect(userErrorMessage("connection", new Error("LIST failed with HTTP 403 (AccessDenied)"))).toBe(
			"The R2 token does not have permission to use this bucket. Give the token Object Read & Write access to this bucket, then select Test connection again."
		);
		expect(userErrorMessage("sync", new Error("GET failed with HTTP 401 (InvalidAccessKeyId)"))).toContain(
			"Re-enter the Access Key ID and Secret Access Key"
		);
	});

	it("explains stale local files and concurrent devices", () => {
		expect(userErrorMessage("sync", new Error("The reviewed sync plan is stale because this file changed: Note.md"))).toContain(
			"A local file changed"
		);
		expect(userErrorMessage("sync-commit", new Error("The remote vault changed before this revision could be committed."))).toContain(
			"Another device finished syncing first"
		);
	});

	it("gives safe guidance for unknown failures without exposing technical details", () => {
		const message = userErrorMessage("sync-after-commit", new TypeError("mysterious internal failure"));
		expect(message).toBe(
			"R2 saved this sync, but this device could not finish applying it. Select Sync again; Isomite will resume safely before starting anything new."
		);
		expect(message).not.toContain("TypeError");
		expect(message).not.toContain("mysterious");
	});

	it("explains invalid pairing and recovery codes", () => {
		expect(userErrorMessage("pairing-import", new Error("The Isomite pairing code is invalid."))).toContain(
			"Copy a new code"
		);
		expect(userErrorMessage("recovery-import", new Error("Malformed recovery key: expected three base64 parts."))).toContain(
			"Copy the complete recovery key"
		);
		expect(userErrorMessage("recovery-import", new Error("The encryption passphrase does not match this Isomite bucket."))).toContain(
			"recovery key saved from this vault"
		);
	});

	it("gives a concrete recovery path for damaged local state", () => {
		expect(userErrorMessage("sync", new Error("Unsupported Isomite local baseline."))).toBe(
			"This device's saved sync recovery state is damaged. Do not reset the R2 bucket; make a fresh vault copy, pair it from a working device, and sync there."
		);
	});
});
