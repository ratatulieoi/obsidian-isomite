import { describe, expect, it } from "vitest";
import { createPairingCode, parsePairingCode } from "../src/sync/pairing";

const PASSWORD = "pair-once-strong-password";
const input = {
	vaultId: "vault-12345678",
	endpoint: "https://abc.r2.cloudflarestorage.com",
	bucket: "vault",
	accessKeyId: "access-key-id",
	secretAccessKey: "secret-access-key",
	encryption: { type: "passphrase" as const, value: "vault-encryption-passphrase" },
};

describe("pairing codes", () => {
	it("round-trips credentials and encryption through an encrypted bundle", async () => {
		const code = await createPairingCode(input, PASSWORD);

		await expect(parsePairingCode(code, PASSWORD)).resolves.toEqual({
			format: "isomite-pairing-payload-v2",
			...input,
		});
		const envelope = new TextDecoder().decode(
			Uint8Array.from(
				atob(code.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(code.length / 4) * 4, "=")),
				(character) => character.charCodeAt(0)
			)
		);
		expect(envelope).not.toContain(input.accessKeyId);
		expect(envelope).not.toContain(input.secretAccessKey);
		expect(envelope).not.toContain(input.encryption.value);
	});

	it("rejects the wrong password", async () => {
		const code = await createPairingCode(input, PASSWORD);
		await expect(parsePairingCode(code, "different-strong-password")).rejects.toThrow("incorrect");
	});

	it("rejects invalid codes and short passwords", async () => {
		await expect(parsePairingCode("not-a-code", PASSWORD)).rejects.toThrow("pairing code is invalid");
		await expect(createPairingCode(input, "short")).rejects.toThrow("at least 16 characters");
	});
});
