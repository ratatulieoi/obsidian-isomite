import { describe, expect, it } from "vitest";
import { createPairingCode, parsePairingCode } from "../src/sync/pairing";

describe("pairing codes", () => {
	it("round-trips vault identity and destination only", () => {
		const input = {
			vaultId: "vault-12345678",
			endpoint: "https://abc.r2.cloudflarestorage.com",
			bucket: "vault",
		};
		const code = createPairingCode(input);

		expect(parsePairingCode(code)).toEqual({ format: "isomite-pairing-v1", ...input });
		expect(new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(code.length / 4) * 4, "=")), (c) => c.charCodeAt(0)))).not.toContain("secretAccessKey");
	});

	it("rejects invalid codes", () => {
		expect(() => parsePairingCode("not-a-code")).toThrow("pairing code is invalid");
	});
});
