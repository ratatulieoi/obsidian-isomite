import { DerivedKeys, decryptString, deriveKeys, encryptString, generateSaltBase64 } from "./crypto";
import { R2Client, R2NotFoundError, R2PreconditionFailedError } from "../r2/r2-client";

const ENCRYPTION_META_KEY = "_isomite/encryption-v1.json";
const FORMAT = "isomite-encryption-v1";
const KEY_CHECK_PLAINTEXT = "isomite-key-check-v1";

interface EncryptionMeta {
	format: typeof FORMAT;
	saltBase64: string;
	keyCheck?: string;
}

export class PassphraseMismatchError extends Error {
	constructor() {
		super("The encryption passphrase does not match this Isomite bucket.");
		this.name = "PassphraseMismatchError";
	}
}

export async function initializeOrVerifyEncryption(client: R2Client, passphrase: string): Promise<DerivedKeys> {
	if (!passphrase) throw new Error("Enter an encryption passphrase.");
	const meta = await getOrCreateEncryptionMeta(client);
	const keys = await deriveKeys(passphrase, meta.value.saltBase64);

	if (meta.value.keyCheck) {
		await assertKeyCheck(keys, meta.value.keyCheck);
		return keys;
	}

	const keyCheck = await encryptString(keys.contentKey, KEY_CHECK_PLAINTEXT);
	const updated: EncryptionMeta = { ...meta.value, keyCheck };
	try {
		await client.putObject(ENCRYPTION_META_KEY, encodeMeta(updated), {
			contentType: "application/json",
			ifMatch: meta.etag,
		});
	} catch (error) {
		if (!(error instanceof R2PreconditionFailedError)) throw error;
		const winner = await readEncryptionMeta(client);
		if (!winner?.value.keyCheck) throw new Error("The bucket encryption metadata changed unexpectedly.");
		await assertKeyCheck(keys, winner.value.keyCheck);
	}
	return keys;
}

export async function verifyRecoveryKey(client: R2Client, keys: DerivedKeys): Promise<void> {
	const meta = await readEncryptionMeta(client);
	if (!meta?.value.keyCheck) throw new Error("Initialize bucket encryption with a passphrase first.");
	await assertKeyCheck(keys, meta.value.keyCheck);
}

async function getOrCreateEncryptionMeta(client: R2Client): Promise<{ value: EncryptionMeta; etag: string }> {
	const existing = await readEncryptionMeta(client);
	if (existing) return existing;

	const value: EncryptionMeta = {
		format: FORMAT,
		saltBase64: generateSaltBase64(),
	};
	try {
		const result = await client.putObject(ENCRYPTION_META_KEY, encodeMeta(value), {
			contentType: "application/json",
			ifNoneMatch: "*",
		});
		return { value, etag: result.etag };
	} catch (error) {
		if (!(error instanceof R2PreconditionFailedError)) throw error;
		const winner = await readEncryptionMeta(client);
		if (winner) return winner;
		throw new Error("The bucket encryption metadata could not be initialized.");
	}
}

async function readEncryptionMeta(client: R2Client): Promise<{ value: EncryptionMeta; etag: string } | undefined> {
	let result;
	try {
		result = await client.getObject(ENCRYPTION_META_KEY);
	} catch (error) {
		if (error instanceof R2NotFoundError) return undefined;
		throw error;
	}

	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(result.body));
	} catch {
		throw new Error("The Isomite bucket encryption metadata is not valid JSON.");
	}
	if (!isEncryptionMeta(value)) throw new Error("The bucket uses an unsupported Isomite encryption format.");
	return { value, etag: result.etag };
}

function isEncryptionMeta(value: unknown): value is EncryptionMeta {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.format === FORMAT &&
		typeof candidate.saltBase64 === "string" &&
		(candidate.keyCheck === undefined || typeof candidate.keyCheck === "string")
	);
}

function encodeMeta(value: EncryptionMeta): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}

async function assertKeyCheck(keys: DerivedKeys, encrypted: string): Promise<void> {
	let plaintext: string;
	try {
		plaintext = await decryptString(keys.contentKey, encrypted);
	} catch {
		throw new PassphraseMismatchError();
	}
	if (plaintext !== KEY_CHECK_PLAINTEXT) throw new PassphraseMismatchError();
}
