import { DerivedKeys } from "../crypto/crypto";
import { remoteBlobObjectKey, remoteBlobPrefix, remoteRevisionObjectKey, remoteRevisionPrefix } from "./revision-codec";
import { RevisionStore } from "./revision-store";
import { RemoteHead, RemoteRevision } from "./types";
import { HISTORY_GC_GRACE_DAYS, retainedRevisionIds } from "./retention";

export async function readRevisionHistory(store: RevisionStore, headRevisionId: string): Promise<RemoteRevision[]> {
	const history: RemoteRevision[] = [];
	const seen = new Set<string>();
	let revisionId: string | null = headRevisionId;
	while (revisionId) {
		if (seen.has(revisionId)) throw new Error("The remote revision history contains a cycle.");
		seen.add(revisionId);
		const revision = await store.readRevision(revisionId);
		history.push(revision);
		revisionId = revision.parentRevisionId;
	}
	return history;
}

/** Best-effort mark-and-sweep. Caller runs only after a successful sync. */
export async function cleanupRemoteHistory(
	store: RevisionStore,
	keys: DerivedKeys,
	head: RemoteHead,
	now: Date = new Date()
): Promise<{ revisionsDeleted: number; blobsDeleted: number }> {
	const retained = await Promise.all(head.history.map((entry) => store.readRevision(entry.revisionId)));
	const retainedRevisionKeys = new Set(await Promise.all(retained.map((revision) => remoteRevisionObjectKey(keys, revision.revisionId))));
	const retainedBlobKeys = new Set(
		await Promise.all(
			[...new Set(retained.flatMap((revision) => revision.files.map((file) => file.contentHash)))].map((hash) =>
				remoteBlobObjectKey(keys, hash)
			)
		)
	);
	const graceCutoff = now.getTime() - HISTORY_GC_GRACE_DAYS * 24 * 60 * 60 * 1000;
	let revisionsDeleted = 0;
	let blobsDeleted = 0;

	for (const object of await store.listAllObjects("_isomite/")) {
		if (Date.parse(object.lastModified) >= graceCutoff) continue;
		try {
			if (object.key.startsWith(remoteRevisionPrefix()) && !retainedRevisionKeys.has(object.key)) {
				await store.deleteObject(object.key, object.etag);
				revisionsDeleted++;
			} else if (object.key.startsWith(remoteBlobPrefix()) && !retainedBlobKeys.has(object.key)) {
				await store.deleteObject(object.key, object.etag);
				blobsDeleted++;
			}
		} catch {
			// Cleanup is best-effort and never invalidates a successful sync.
		}
	}
	return { revisionsDeleted, blobsDeleted };
}
