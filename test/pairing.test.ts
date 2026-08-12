import { describe, expect, it } from "vitest";
import { createPairingCode, parsePairingCode } from "../src/sync/pairing";

const input = {
	vaultId: "vault-12345678",
	endpoint: "https://abc.r2.cloudflarestorage.com",
	bucket: "vault",
	accessKeyId: "access-key-id",
	secretAccessKey: "secret-access-key",
	encryption: { type: "passphrase" as const, value: "vault-encryption-passphrase" },
};

describe("pairing codes", () => {
	it("round-trips all configuration in one generated bearer code", () => {
		const code = createPairingCode(input);

		expect(code.startsWith("isomite-")).toBe(false);
		expect(parsePairingCode(code)).toEqual({
			format: "isomite-pairing-v3",
			...input,
		});
	});

	it("accepts the previous prefixed form and rejects invalid codes", () => {
		const code = createPairingCode(input);
		expect(parsePairingCode(`isomite-pairing-v3.${code}`).vaultId).toBe(input.vaultId);
		expect(() => parsePairingCode("not-a-code")).toThrow("pairing code is invalid");
		expect(() => parsePairingCode("isomite-pairing-v3.not-base64!")).toThrow("pairing code is invalid");
	});
});
