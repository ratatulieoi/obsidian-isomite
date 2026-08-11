import { decryptSyncBlob, DerivedKeys, encryptSyncBlob, keyedContentHash } from "../crypto/crypto";
import { R2Client, R2NotFoundError, R2PreconditionFailedError } from "../r2/r2-client";
import {
	decodeRemoteHead,
	decodeRemoteRevision,
	encodeRemoteHead,
	encodeRemoteRevision,
	remoteBlobObjectKey,
	remoteHeadObjectKey,
	remoteRevisionObjectKey,
} from "./revision-codec";
import { RemoteHead, RemoteRevision } from "./types";
import { retainedRevisionIds } from "./retention";

export interface StoredHead {
	head: RemoteHead;
	etag: string;
}

export class RemoteHeadChangedError extends Error {
	constructor() {
		super("The remote vault changed before this revision could be committed. Rescan before applying.");
		this.name = "RemoteHeadChangedError";
	}
}

/** R2 persistence for immutable blobs/revisions and one conditional head. */
export class RevisionStore {
	constructor(
		private readonly client: R2Client,
		private readonly keys: DerivedKeys
	) {}

	async readHead(): Promise<StoredHead | undefined> {
		try {
			const result = await this.client.getObject(remoteHeadObjectKey());
			return { head: await decodeRemoteHead(this.keys, result.body), etag: result.etag };
		} catch (error) {
			if (error instanceof R2NotFoundError) return undefined;
			throw error;
		}
	}

	/** Read-only revalidation for download/local-only applies. */
	async revalidateHead(expectedHead: StoredHead): Promise<StoredHead> {
		const current = await this.readHead();
		if (!current || current.etag !== expectedHead.etag ||
			current.head.revisionId !== expectedHead.head.revisionId ||
			current.head.generation !== expectedHead.head.generation) {
			throw new RemoteHeadChangedError();
		}
		return current;
	}

	async listAllObjects(prefix = ""): Promise<Array<{ key: string; etag: string; size: number; lastModified: string }>> {
		const objects = [];
		let continuationToken: string | undefined;
		do {
			const page = await this.client.listObjects(prefix, continuationToken);
			objects.push(...page.objects);
			continuationToken = page.nextContinuationToken;
		} while (continuationToken);
		return objects;
	}

	async deleteObject(key: string, ifMatch?: string): Promise<void> {
		await this.client.deleteObject(key, ifMatch);
	}

	async readRevision(revisionId: string): Promise<RemoteRevision> {
		const key = await remoteRevisionObjectKey(this.keys, revisionId);
		const result = await this.client.getObject(key);
		const revision = await decodeRemoteRevision(this.keys, result.body);
		if (revision.revisionId !== revisionId) throw new Error("The encrypted revision does not match its requested ID.");
		return revision;
	}

	/**
	 * Uploading the same plaintext again is safe: a keyed content hash maps it
	 * to one immutable key. Conditional create lets renames and retries reuse it.
	 */
	async putBlob(plaintext: Uint8Array): Promise<{ contentHash: string; objectKey: string; uploaded: boolean }> {
		const contentHash = await keyedContentHash(this.keys.contentHashKey, plaintext);
		const objectKey = await remoteBlobObjectKey(this.keys, contentHash);
		const encrypted = await encryptSyncBlob(this.keys.contentKey, plaintext, contentHash);
		try {
			await this.client.putObject(objectKey, encrypted, {
				contentType: "application/octet-stream",
				ifNoneMatch: "*",
			});
			return { contentHash, objectKey, uploaded: true };
		} catch (error) {
			if (error instanceof R2PreconditionFailedError) {
				return { contentHash, objectKey, uploaded: false };
			}
			throw error;
		}
	}

	async getBlob(contentHash: string): Promise<Uint8Array> {
		const key = await remoteBlobObjectKey(this.keys, contentHash);
		const result = await this.client.getObject(key);
		const plaintext = await decryptSyncBlob(this.keys.contentKey, result.body, contentHash);
		const actualHash = await keyedContentHash(this.keys.contentHashKey, plaintext);
		if (actualHash !== contentHash.toLowerCase()) throw new Error("The downloaded sync blob failed content verification.");
		return plaintext;
	}

	/**
	 * Writes an immutable revision first, then atomically advances the head.
	 * A stale ETag or unexpected existing head commits nothing visible.
	 */
	async commitRevision(revision: RemoteRevision, expectedHead?: StoredHead): Promise<StoredHead> {
		if (expectedHead) {
			if (revision.parentRevisionId !== expectedHead.head.revisionId) {
				throw new Error("The new revision does not descend from the expected remote head.");
			}
			if (revision.generation !== expectedHead.head.generation + 1) {
				throw new Error("The new revision generation is not sequential.");
			}
		} else if (revision.parentRevisionId !== null || revision.generation !== 1) {
			throw new Error("The first remote revision must have generation 1 and no parent.");
		}

		const revisionKey = await remoteRevisionObjectKey(this.keys, revision.revisionId);
		const encryptedRevision = await encodeRemoteRevision(this.keys, revision);
		try {
			await this.client.putObject(revisionKey, encryptedRevision, {
				contentType: "application/octet-stream",
				ifNoneMatch: "*",
			});
		} catch (error) {
			if (!(error instanceof R2PreconditionFailedError)) throw error;
			const existing = await this.readRevision(revision.revisionId);
			if (JSON.stringify(existing) !== JSON.stringify(canonicalComparable(revision))) {
				throw new Error("A different immutable revision already uses this revision ID.");
			}
		}

		const fullHistory = [
			{ revisionId: revision.revisionId, generation: revision.generation, createdAt: revision.createdAt },
			...(expectedHead?.head.history ?? []),
		];
		const retainedHistoryIds = retainedRevisionIds(fullHistory, new Date(revision.createdAt));
		const head: RemoteHead = {
			format: "isomite-head-v1",
			vaultId: revision.vaultId,
			revisionId: revision.revisionId,
			generation: revision.generation,
			history: fullHistory.filter((entry) => retainedHistoryIds.has(entry.revisionId)),
		};
		try {
			const result = await this.client.putObject(remoteHeadObjectKey(), await encodeRemoteHead(this.keys, head), {
				contentType: "application/octet-stream",
				...(expectedHead ? { ifMatch: expectedHead.etag } : { ifNoneMatch: "*" as const }),
			});
			return { head, etag: result.etag };
		} catch (error) {
			if (error instanceof R2PreconditionFailedError) throw new RemoteHeadChangedError();
			throw error;
		}
	}
}

function canonicalComparable(revision: RemoteRevision): RemoteRevision {
	return {
		...revision,
		files: [...revision.files]
			.map((file) => ({ ...file, contentHash: file.contentHash.toLowerCase() }))
			.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
		ignorePatterns: [...revision.ignorePatterns].sort(),
	};
}
