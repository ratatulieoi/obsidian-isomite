import { asBufferSource } from "../util/bytes";

const PBKDF2_ITERATIONS = 600_000;
const AES_KEY_LENGTH = 256;
const GCM_NONCE_BYTES = 12;
const SALT_BYTES = 16;
const CONTENT_BLOB_VERSION = 0x01;

export interface DerivedKeys {
	contentKey: CryptoKey;
	pathHmacKey: CryptoKey;
	contentHashKey: CryptoKey;
}

export function generateSaltBase64(): string {
	const salt = new Uint8Array(SALT_BYTES);
	crypto.getRandomValues(salt);
	return toBase64(salt);
}

/**
 * Derives independent encryption, path-obfuscation, and keyed-hash keys from
 * one passphrase. Isomite-specific labels deliberately keep this format
 * separate from every other sync application.
 */
export async function deriveKeys(passphrase: string, saltBase64: string): Promise<DerivedKeys> {
	if (!passphrase) throw new Error("Enter an encryption passphrase.");
	const baseSalt = fromBase64(saltBase64);
	if (baseSalt.byteLength !== SALT_BYTES) throw new Error("The bucket encryption salt is invalid.");

	const encoder = new TextEncoder();
	const passphraseKey = await crypto.subtle.importKey(
		"raw",
		asBufferSource(encoder.encode(passphrase)),
		"PBKDF2",
		false,
		["deriveKey"]
	);

	const contentKey = await deriveAesKey(passphraseKey, concatBytes(baseSalt, encoder.encode("isomite-content-v1")));
	const pathHmacKey = await deriveHmacKey(passphraseKey, concatBytes(baseSalt, encoder.encode("isomite-path-v1")));
	const contentHashKey = await deriveHmacKey(
		passphraseKey,
		concatBytes(baseSalt, encoder.encode("isomite-content-hash-v1"))
	);
	return { contentKey, pathHmacKey, contentHashKey };
}

export async function encryptBytes(
	key: CryptoKey,
	plaintext: Uint8Array,
	additionalData?: Uint8Array
): Promise<Uint8Array> {
	const nonce = new Uint8Array(GCM_NONCE_BYTES);
	crypto.getRandomValues(nonce);
	const algorithm: AesGcmParams = { name: "AES-GCM", iv: asBufferSource(nonce) };
	if (additionalData) algorithm.additionalData = asBufferSource(additionalData);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(algorithm, key, asBufferSource(plaintext))
	);
	return concatBytes(nonce, ciphertext);
}

export async function decryptBytes(
	key: CryptoKey,
	blob: Uint8Array,
	additionalData?: Uint8Array
): Promise<Uint8Array> {
	if (blob.byteLength < GCM_NONCE_BYTES + 16) throw new Error("Encrypted data is truncated.");
	const nonce = blob.slice(0, GCM_NONCE_BYTES);
	const ciphertext = blob.slice(GCM_NONCE_BYTES);
	const algorithm: AesGcmParams = { name: "AES-GCM", iv: asBufferSource(nonce) };
	if (additionalData) algorithm.additionalData = asBufferSource(additionalData);
	return new Uint8Array(await crypto.subtle.decrypt(algorithm, key, asBufferSource(ciphertext)));
}

/** Encrypts content and cryptographically binds it to its normalized path. */
export async function encryptContentBlob(key: CryptoKey, plaintext: Uint8Array, path: string): Promise<Uint8Array> {
	const aad = new TextEncoder().encode(normalizePath(path));
	const encrypted = await encryptBytes(key, plaintext, aad);
	const blob = new Uint8Array(encrypted.byteLength + 1);
	blob[0] = CONTENT_BLOB_VERSION;
	blob.set(encrypted, 1);
	return blob;
}

export async function decryptContentBlob(key: CryptoKey, blob: Uint8Array, path: string): Promise<Uint8Array> {
	if (blob[0] !== CONTENT_BLOB_VERSION) throw new Error("Unsupported Isomite encrypted-content version.");
	const aad = new TextEncoder().encode(normalizePath(path));
	return decryptBytes(key, blob.slice(1), aad);
}

export async function encryptString(key: CryptoKey, text: string): Promise<string> {
	return toBase64(await encryptBytes(key, new TextEncoder().encode(text)));
}

export async function decryptString(key: CryptoKey, encryptedBase64: string): Promise<string> {
	return new TextDecoder().decode(await decryptBytes(key, fromBase64(encryptedBase64)));
}

export async function encryptPath(key: CryptoKey, path: string): Promise<string> {
	return encryptString(key, normalizePath(path));
}

export async function decryptPath(key: CryptoKey, encryptedPath: string): Promise<string> {
	return decryptString(key, encryptedPath);
}

export async function hmacObjectKey(pathHmacKey: CryptoKey, path: string): Promise<string> {
	return hmacHex(pathHmacKey, new TextEncoder().encode(normalizePath(path)));
}

export async function keyedContentHash(contentHashKey: CryptoKey, bytes: Uint8Array): Promise<string> {
	return hmacHex(contentHashKey, bytes);
}

/**
 * Exports all three raw derived keys. This is sensitive key material and must
 * be backed up outside the vault.
 */
export async function exportRecoveryKey(keys: DerivedKeys): Promise<string> {
	const content = new Uint8Array(await crypto.subtle.exportKey("raw", keys.contentKey));
	const path = new Uint8Array(await crypto.subtle.exportKey("raw", keys.pathHmacKey));
	const hash = new Uint8Array(await crypto.subtle.exportKey("raw", keys.contentHashKey));
	return `${toBase64(content)}.${toBase64(path)}.${toBase64(hash)}`;
}

export async function importRecoveryKey(value: string): Promise<DerivedKeys> {
	const parts = value.trim().split(".");
	if (parts.length !== 3 || parts.some((part) => !part)) {
		throw new Error("Malformed recovery key: expected three base64 parts.");
	}
	const [contentBytes, pathBytes, hashBytes] = parts.map(fromBase64);
	if (contentBytes.byteLength !== 32 || pathBytes.byteLength !== 32 || hashBytes.byteLength !== 32) {
		throw new Error("Malformed recovery key: every key must be 32 bytes.");
	}

	const contentKey = await crypto.subtle.importKey(
		"raw",
		asBufferSource(contentBytes),
		{ name: "AES-GCM", length: AES_KEY_LENGTH },
		true,
		["encrypt", "decrypt"]
	);
	const pathHmacKey = await crypto.subtle.importKey(
		"raw",
		asBufferSource(pathBytes),
		{ name: "HMAC", hash: "SHA-256", length: 256 },
		true,
		["sign"]
	);
	const contentHashKey = await crypto.subtle.importKey(
		"raw",
		asBufferSource(hashBytes),
		{ name: "HMAC", hash: "SHA-256", length: 256 },
		true,
		["sign"]
	);
	return { contentKey, pathHmacKey, contentHashKey };
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").normalize("NFC");
}

async function deriveAesKey(baseKey: CryptoKey, salt: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt: asBufferSource(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
		baseKey,
		{ name: "AES-GCM", length: AES_KEY_LENGTH },
		true,
		["encrypt", "decrypt"]
	);
}

async function deriveHmacKey(baseKey: CryptoKey, salt: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt: asBufferSource(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
		baseKey,
		{ name: "HMAC", hash: "SHA-256", length: 256 },
		true,
		["sign"]
	);
}

async function hmacHex(key: CryptoKey, bytes: Uint8Array): Promise<string> {
	const signature = await crypto.subtle.sign("HMAC", key, asBufferSource(bytes));
	return Array.from(new Uint8Array(signature))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left, 0);
	result.set(right, left.byteLength);
	return result;
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
		return bytes;
	} catch {
		throw new Error("Malformed base64 key material.");
	}
}
