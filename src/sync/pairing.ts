import { asBufferSource } from "../util/bytes";

const PAIRING_FORMAT = "isomite-pairing-v2" as const;
const PAYLOAD_FORMAT = "isomite-pairing-payload-v2" as const;
const PAIRING_ITERATIONS = 600_000;
const PAIRING_SALT_BYTES = 16;
const PAIRING_NONCE_BYTES = 12;
const MIN_PAIRING_PASSWORD_LENGTH = 16;
const MAX_PAIRING_CODE_LENGTH = 32_768;
const PAIRING_ADDITIONAL_DATA = new TextEncoder().encode(PAIRING_FORMAT);

export type PairingEncryption =
	| { type: "passphrase"; value: string }
	| { type: "recoveryKey"; value: string };

export interface PairingPayload {
	format: typeof PAYLOAD_FORMAT;
	vaultId: string;
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	encryption: PairingEncryption;
}

interface PairingEnvelope {
	format: typeof PAIRING_FORMAT;
	iterations: typeof PAIRING_ITERATIONS;
	salt: string;
	nonce: string;
	ciphertext: string;
}

/** Encrypts all information needed by a new device with a separate one-time password. */
export async function createPairingCode(
	payload: Omit<PairingPayload, "format">,
	pairingPassword: string
): Promise<string> {
	assertPairingPassword(pairingPassword);
	const completePayload: PairingPayload = { format: PAYLOAD_FORMAT, ...payload };
	assertPayload(completePayload);

	const salt = randomBytes(PAIRING_SALT_BYTES);
	const nonce = randomBytes(PAIRING_NONCE_BYTES);
	const key = await derivePairingKey(pairingPassword, salt);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: asBufferSource(nonce),
				additionalData: asBufferSource(PAIRING_ADDITIONAL_DATA),
			},
			key,
			asBufferSource(new TextEncoder().encode(JSON.stringify(completePayload)))
		)
	);
	const envelope: PairingEnvelope = {
		format: PAIRING_FORMAT,
		iterations: PAIRING_ITERATIONS,
		salt: toBase64Url(salt),
		nonce: toBase64Url(nonce),
		ciphertext: toBase64Url(ciphertext),
	};
	return toBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
}

export async function parsePairingCode(code: string, pairingPassword: string): Promise<PairingPayload> {
	assertPairingPassword(pairingPassword);
	const envelope = decodeEnvelope(code);
	const salt = fromBase64Url(envelope.salt);
	const nonce = fromBase64Url(envelope.nonce);
	const ciphertext = fromBase64Url(envelope.ciphertext);
	if (salt.byteLength !== PAIRING_SALT_BYTES || nonce.byteLength !== PAIRING_NONCE_BYTES || ciphertext.byteLength < 16) {
		throw new Error("The Isomite pairing code is invalid.");
	}

	let value: unknown;
	try {
		const key = await derivePairingKey(pairingPassword, salt);
		const plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: asBufferSource(nonce),
				additionalData: asBufferSource(PAIRING_ADDITIONAL_DATA),
			},
			key,
			asBufferSource(ciphertext)
		);
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
	} catch {
		throw new Error("The pairing password is incorrect or the pairing code is damaged.");
	}
	assertPayload(value);
	return value;
}

function decodeEnvelope(code: string): PairingEnvelope {
	const normalized = code.trim();
	if (!normalized || normalized.length > MAX_PAIRING_CODE_LENGTH) {
		throw new Error("The Isomite pairing code is invalid.");
	}
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(normalized))) as unknown;
	} catch {
		throw new Error("The Isomite pairing code is invalid.");
	}
	if (!isRecord(value) || value.format !== PAIRING_FORMAT || value.iterations !== PAIRING_ITERATIONS ||
		typeof value.salt !== "string" || typeof value.nonce !== "string" || typeof value.ciphertext !== "string") {
		throw new Error("The Isomite pairing code is invalid.");
	}
	return value as unknown as PairingEnvelope;
}

function assertPayload(value: unknown): asserts value is PairingPayload {
	if (!isRecord(value) || value.format !== PAYLOAD_FORMAT || typeof value.vaultId !== "string" ||
		typeof value.endpoint !== "string" || typeof value.bucket !== "string" ||
		typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" ||
		!isPairingEncryption(value.encryption)) {
		throw new Error("The Isomite pairing payload is invalid.");
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

function assertPairingPassword(value: string): void {
	if (value.length < MIN_PAIRING_PASSWORD_LENGTH) {
		throw new Error(`Use a one-time pairing password of at least ${MIN_PAIRING_PASSWORD_LENGTH} characters.`);
	}
}

async function derivePairingKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey(
		"raw",
		asBufferSource(new TextEncoder().encode(password)),
		"PBKDF2",
		false,
		["deriveKey"]
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: asBufferSource(salt),
			iterations: PAIRING_ITERATIONS,
			hash: "SHA-256",
		},
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
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
