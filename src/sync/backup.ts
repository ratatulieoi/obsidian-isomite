import { Zip, ZipPassThrough } from "fflate";
import { SyncCancelledError, SyncProgressCallback } from "./progress";
import { SyncVaultAdapter } from "./vault-adapter";

/** Creates the required pre-first-sync ZIP without retaining all input files. */
export async function createVaultZipBackup(
	vault: SyncVaultAdapter,
	ignorePatterns: string[] = [],
	onProgress?: SyncProgressCallback,
	signal?: AbortSignal
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	let failure: Error | undefined;
	let completed = false;
	const zip = new Zip((error, chunk, final) => {
		if (error) failure = error;
		else if (chunk.byteLength) {
			chunks.push(chunk);
			total += chunk.byteLength;
		}
		if (final) completed = true;
	});

	const files = await vault.listFiles(ignorePatterns);
	let completedFiles = 0;
	for (const file of files) {
		if (signal?.aborted) throw new SyncCancelledError();
		if (failure) throw failure;
		const entry = new ZipPassThrough(file.path);
		entry.mtime = new Date(file.mtime);
		zip.add(entry);
		entry.push(await vault.readFile(file.path), true);
		completedFiles++;
		onProgress?.({
			percent: 30 + Math.round((completedFiles / Math.max(files.length, 1)) * 5),
			stage: `Backing up ${completedFiles} of ${files.length} files`,
		});
	}
	zip.end();
	if (failure) throw failure;
	if (!completed) throw new Error("The local vault ZIP backup did not finish.");

	const archive = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		archive.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return archive;
}
