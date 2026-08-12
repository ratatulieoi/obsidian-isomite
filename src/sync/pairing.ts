const PAIRING_FORMAT = "isomite-pairing-v3" as const;
const LEGACY_PAIRING_PREFIX = `${PAIRING_FORMAT}.`;
const MAX_PAIRING_CODE_LENGTH = 32_768;

export type PairingEncryption =
	| { type: "passphrase"; value: string }
	| { type: "recoveryKey"; value: string };

export interface PairingPayload {
	format: typeof PAIRING_FORMAT;
	vaultId: string;
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	encryption: PairingEncryption;
}

/**
 * Creates a self-contained bearer code. Anyone who has this code can use the
 * included R2 credentials and encryption access, so it must be kept secret.
 */
export function createPairingCode(payload: Omit<PairingPayload, "format">): string {
	const completePayload: PairingPayload = { format: PAIRING_FORMAT, ...payload };
	assertPayload(completePayload);
	return toBase64Url(new TextEncoder().encode(JSON.stringify(completePayload)));
}

export function parsePairingCode(code: string): PairingPayload {
	const normalized = code.trim();
	if (!normalized || normalized.length > MAX_PAIRING_CODE_LENGTH) {
		throw new Error("The Isomite pairing code is invalid.");
	}
	const encoded = normalized.startsWith(LEGACY_PAIRING_PREFIX)
		? normalized.slice(LEGACY_PAIRING_PREFIX.length)
		: normalized;
	let value: unknown;
	try {
		value = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(encoded))
		) as unknown;
	} catch {
		throw new Error("The Isomite pairing code is invalid.");
	}
	assertPayload(value);
	return value;
}

function assertPayload(value: unknown): asserts value is PairingPayload {
	if (!isRecord(value) || value.format !== PAIRING_FORMAT || typeof value.vaultId !== "string" ||
		typeof value.endpoint !== "string" || typeof value.bucket !== "string" ||
		typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" ||
		!isPairingEncryption(value.encryption)) {
		throw new Error("The Isomite pairing code is invalid.");
	}
	if (!/^vault-[A-Za-z0-9_-]{8,127}$/.test(value.vaultId)) throw new Error("The pairing vault ID is invalid.");
	let endpoint: URL;
	try {
		endpoint = new URL(value.endpoint);
	} catch {
		throw new Error("The pairing endpoint is invalid.");
	}
	if (endpoint.protocol !== "https:" || endpoint.origin !== value.endpoint || !value.bucket.trim() ||
		!value.accessKeyId.trim() || !value.secretAccessKey.trim()) {
		throw new Error("The pairing destination or credentials are invalid.");
	}
}

function isPairingEncryption(value: unknown): value is PairingEncryption {
	return isRecord(value) && (value.type === "passphrase" || value.type === "recoveryKey") &&
		typeof value.value === "string" && Boolean(value.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
