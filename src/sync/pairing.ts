const PAIRING_FORMAT = "isomite-pairing-v1" as const;

interface PairingPayload {
	format: typeof PAIRING_FORMAT;
	vaultId: string;
	endpoint: string;
	bucket: string;
}

/** Contains location/identity only. It never contains R2 credentials or keys. */
export function createPairingCode(payload: Omit<PairingPayload, "format">): string {
	assertPayload({ format: PAIRING_FORMAT, ...payload });
	return toBase64Url(new TextEncoder().encode(JSON.stringify({ format: PAIRING_FORMAT, ...payload })));
}

export function parsePairingCode(code: string): PairingPayload {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(code.trim()))) as unknown;
	} catch {
		throw new Error("The Isomite pairing code is invalid.");
	}
	assertPayload(value);
	return value;
}

function assertPayload(value: unknown): asserts value is PairingPayload {
	if (!value || typeof value !== "object") throw new Error("The Isomite pairing code is invalid.");
	const payload = value as Record<string, unknown>;
	if (payload.format !== PAIRING_FORMAT || typeof payload.vaultId !== "string" ||
		typeof payload.endpoint !== "string" || typeof payload.bucket !== "string") {
		throw new Error("The Isomite pairing code is invalid.");
	}
	if (!/^vault-[A-Za-z0-9_-]{8,127}$/.test(payload.vaultId)) throw new Error("The pairing vault ID is invalid.");
	let endpoint: URL;
	try {
		endpoint = new URL(payload.endpoint);
	} catch {
		throw new Error("The pairing endpoint is invalid.");
	}
	if (endpoint.protocol !== "https:" || endpoint.origin !== payload.endpoint || !payload.bucket) {
		throw new Error("The pairing destination is invalid.");
	}
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(base64);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
