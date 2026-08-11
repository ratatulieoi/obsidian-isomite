import { RevisionStore } from "./revision-store";
import { mergeText } from "./text-merge";
import { SyncPlan } from "./types";
import { SyncVaultAdapter } from "./vault-adapter";

/**
 * Resolves conservative text merges before review. The caller can display the
 * resulting bytes as a diff. Unsafe/malformed/binary content becomes keep-both.
 */
export async function resolvePlanMerges(
	plan: SyncPlan,
	vault: SyncVaultAdapter,
	store: RevisionStore,
	readBase: (path: string, contentHash: string) => Promise<Uint8Array | undefined>
): Promise<SyncPlan> {
	const entries = [];
	for (const entry of plan.entries) {
		if (entry.action !== "mergeText" || !entry.base || !entry.local || !entry.remote) {
			entries.push(entry);
			continue;
		}
		try {
			const [baseBytes, localBytes, remoteBytes] = await Promise.all([
				readBase(entry.path, entry.base.contentHash),
				vault.readFile(entry.path),
				store.getBlob(entry.remote.contentHash),
			]);
			if (!baseBytes) {
				entries.push({ ...entry, action: "keepBoth" as const });
				continue;
			}
			const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			const result = mergeText(decode(baseBytes), decode(localBytes), decode(remoteBytes));
			entries.push(
				result.status === "merged"
					? { ...entry, resolvedContent: new TextEncoder().encode(result.text) }
					: { ...entry, action: "keepBoth" as const }
			);
		} catch {
			entries.push({ ...entry, action: "keepBoth" as const });
		}
	}
	return { ...plan, entries };
}
