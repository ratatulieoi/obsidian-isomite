import { decryptBytes, DerivedKeys, encryptBytes } from "../crypto/crypto";
import { SyncBaseline, SYNC_BASELINE_FORMAT, SyncJournal, SYNC_JOURNAL_FORMAT } from "./types";

const BASELINE_AAD = new TextEncoder().encode("isomite-local-baseline-v1");
const JOURNAL_AAD = new TextEncoder().encode("isomite-local-journal-v1");

export async function encodeLocalBaseline(keys: DerivedKeys, baseline: SyncBaseline): Promise<string> {
	assertBaseline(baseline);
	return toBase64(await encryptBytes(keys.contentKey, encodeJson(baseline), BASELINE_AAD));
}

export async function decodeLocalBaseline(keys: DerivedKeys, value: string): Promise<SyncBaseline> {
	const baseline = parseJson(await decryptBytes(keys.contentKey, fromBase64(value), BASELINE_AAD));
	assertBaseline(baseline);
	return baseline;
}

export async function encodeLocalJournal(keys: DerivedKeys, journal: SyncJournal): Promise<string> {
	assertJournal(journal);
	return toBase64(await encryptBytes(keys.contentKey, encodeJson(journal), JOURNAL_AAD));
}

export async function decodeLocalJournal(keys: DerivedKeys, value: string): Promise<SyncJournal> {
	const journal = parseJson(await decryptBytes(keys.contentKey, fromBase64(value), JOURNAL_AAD));
	assertJournal(journal);
	return journal;
}

function assertBaseline(value: unknown): asserts value is SyncBaseline {
	if (!isRecord(value) || value.format !== SYNC_BASELINE_FORMAT || !Array.isArray(value.files)) {
		throw new Error("Unsupported Isomite local baseline.");
	}
	if (typeof value.vaultId !== "string" || typeof value.revisionId !== "string" || !isGeneration(value.generation)) {
		throw new Error("Invalid Isomite local baseline identity.");
	}
	for (const file of value.files) {
		if (!isFileState(file)) throw new Error("Invalid file in Isomite local baseline.");
	}
}

function assertJournal(value: unknown): asserts value is SyncJournal {
	if (!isRecord(value) || value.format !== SYNC_JOURNAL_FORMAT || !Array.isArray(value.operations) || !Array.isArray(value.targetFiles)) {
		throw new Error("Unsupported Isomite local sync journal.");
	}
	if ((value.phase !== "prepared" && value.phase !== "committed") ||
		typeof value.targetVaultId !== "string" || typeof value.targetRevisionId !== "string" ||
		!isGeneration(value.targetGeneration) || typeof value.createdAt !== "string") {
		throw new Error("Invalid Isomite local sync journal metadata.");
	}
	if (value.targetFiles.some((file) => !isFileState(file))) throw new Error("Invalid sync journal target file.");
	for (const operation of value.operations) {
		if (!isRecord(operation) || (operation.type !== "write" && operation.type !== "trash") || typeof operation.path !== "string") {
			throw new Error("Invalid Isomite journal operation.");
		}
		if (operation.contentHash !== undefined && typeof operation.contentHash !== "string") throw new Error("Invalid journal hash.");
		if (operation.expectedLocalHash !== undefined && typeof operation.expectedLocalHash !== "string") throw new Error("Invalid journal hash.");
	}
}

function isFileState(value: unknown): boolean {
	return isRecord(value) && typeof value.path === "string" && typeof value.contentHash === "string" &&
		typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= 0;
}

function isGeneration(value: unknown): boolean {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw new Error("Encrypted Isomite local state is invalid JSON.");
	}
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	try {
		const binary = atob(value);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		throw new Error("Encrypted Isomite local state is invalid base64.");
	}
}
