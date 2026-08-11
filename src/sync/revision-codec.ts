import { decryptBytes, DerivedKeys, encryptBytes, hmacObjectKey } from "../crypto/crypto";
import { RemoteHead, RemoteRevision, REMOTE_HEAD_FORMAT, REMOTE_REVISION_FORMAT } from "./types";

const REVISION_AAD = new TextEncoder().encode("isomite-revision-v1");
const HEAD_AAD = new TextEncoder().encode("isomite-head-v1");
const HEAD_KEY = "_isomite/head-v1";

export function remoteHeadObjectKey(): string {
	return HEAD_KEY;
}

export function remoteRevisionPrefix(): string {
	return "_isomite/revisions/";
}

export function remoteBlobPrefix(): string {
	return "_isomite/blobs/";
}

export async function remoteRevisionObjectKey(keys: DerivedKeys, revisionId: string): Promise<string> {
	if (!isIdentifier(revisionId)) throw new Error("The revision ID is invalid.");
	const hiddenId = await hmacObjectKey(keys.pathHmacKey, `revision:${revisionId}`);
	return `${remoteRevisionPrefix()}${hiddenId}`;
}

export async function remoteBlobObjectKey(keys: DerivedKeys, contentHash: string): Promise<string> {
	if (!/^[0-9a-f]{64}$/i.test(contentHash)) throw new Error("The content hash is invalid.");
	const hiddenHash = await hmacObjectKey(keys.pathHmacKey, `blob:${contentHash.toLowerCase()}`);
	return `${remoteBlobPrefix()}${hiddenHash}`;
}

export async function encodeRemoteRevision(keys: DerivedKeys, revision: RemoteRevision): Promise<Uint8Array> {
	assertRevision(revision);
	return encryptBytes(keys.contentKey, encodeJson(canonicalRevision(revision)), REVISION_AAD);
}

export async function decodeRemoteRevision(keys: DerivedKeys, encrypted: Uint8Array): Promise<RemoteRevision> {
	const revision = parseJson(await decryptBytes(keys.contentKey, encrypted, REVISION_AAD));
	assertRevision(revision);
	return canonicalRevision(revision);
}

export async function encodeRemoteHead(keys: DerivedKeys, head: RemoteHead): Promise<Uint8Array> {
	assertHead(head);
	return encryptBytes(keys.contentKey, encodeJson(head), HEAD_AAD);
}

export async function decodeRemoteHead(keys: DerivedKeys, encrypted: Uint8Array): Promise<RemoteHead> {
	const head = parseJson(await decryptBytes(keys.contentKey, encrypted, HEAD_AAD));
	assertHead(head);
	return head;
}

function canonicalRevision(revision: RemoteRevision): RemoteRevision {
	return {
		...revision,
		files: revision.files
			.map((file) => ({ ...file, path: normalizePath(file.path), contentHash: file.contentHash.toLowerCase() }))
			.sort((left, right) => comparePaths(left.path, right.path)),
		ignorePatterns: [...revision.ignorePatterns].sort(comparePaths),
	};
}

function assertRevision(value: unknown): asserts value is RemoteRevision {
	if (!isRecord(value) || value.format !== REMOTE_REVISION_FORMAT) throw new Error("Unsupported Isomite revision format.");
	if (!isIdentifier(value.vaultId) || !isIdentifier(value.revisionId) || !isIdentifier(value.deviceId)) {
		throw new Error("The encrypted revision identity is invalid.");
	}
	if (value.parentRevisionId !== null && !isIdentifier(value.parentRevisionId)) {
		throw new Error("The encrypted parent revision ID is invalid.");
	}
	if (!isGeneration(value.generation) || !isIsoDate(value.createdAt)) {
		throw new Error("The encrypted revision metadata is invalid.");
	}
	if (!Array.isArray(value.files) || !Array.isArray(value.ignorePatterns)) {
		throw new Error("The encrypted revision file list is invalid.");
	}

	const paths = new Set<string>();
	for (const rawFile of value.files) {
		if (!isRecord(rawFile) || typeof rawFile.path !== "string" || !rawFile.path) {
			throw new Error("The encrypted revision contains an invalid path.");
		}
		const path = normalizePath(rawFile.path);
		if (path !== rawFile.path || paths.has(path)) throw new Error(`The encrypted revision contains a duplicate or non-normalized path: ${path}`);
		paths.add(path);
		if (!/^[0-9a-f]{64}$/i.test(String(rawFile.contentHash)) || !isSize(rawFile.size)) {
			throw new Error(`The encrypted revision contains invalid file metadata: ${path}`);
		}
	}
	if (value.ignorePatterns.some((pattern) => typeof pattern !== "string" || !pattern)) {
		throw new Error("The encrypted revision contains an invalid ignore pattern.");
	}
}

function assertHead(value: unknown): asserts value is RemoteHead {
	if (!isRecord(value) || value.format !== REMOTE_HEAD_FORMAT) throw new Error("Unsupported Isomite head format.");
	if (!isIdentifier(value.vaultId) || !isIdentifier(value.revisionId) || !isGeneration(value.generation)) {
		throw new Error("The encrypted remote head is invalid.");
	}
	if (value.history === undefined) {
		value.history = [{ revisionId: value.revisionId, generation: value.generation, createdAt: new Date(0).toISOString() }];
	}
	if (!Array.isArray(value.history)) throw new Error("The encrypted remote head history is invalid.");
	for (const entry of value.history) {
		if (!isRecord(entry) || !isIdentifier(entry.revisionId) || !isGeneration(entry.generation) || !isIsoDate(entry.createdAt)) {
			throw new Error("The encrypted remote head history is invalid.");
		}
	}
	if (!value.history.length || value.history[0].revisionId !== value.revisionId || value.history[0].generation !== value.generation) {
		throw new Error("The encrypted remote head history does not contain its current revision.");
	}
}

function encodeJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw new Error("Encrypted Isomite metadata is invalid JSON.");
	}
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").normalize("NFC").replace(/^\/+/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
}

function isGeneration(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSize(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
