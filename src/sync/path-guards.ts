import { RemoteRevisionFile } from "./types";

export interface PathCollision {
	type: "case" | "fileFolder";
	paths: string[];
}

/** Finds paths that cannot coexist safely on common vault filesystems. */
export function findPathCollisions(files: Array<{ path: string }>): PathCollision[] {
	const normalized = [...new Set(files.map((file) => normalizePath(file.path)))].sort();
	const collisions: PathCollision[] = [];
	const byCaseFoldedPath = new Map<string, string[]>();

	for (const path of normalized) {
		const folded = path.toLocaleLowerCase("en-US");
		const group = byCaseFoldedPath.get(folded) ?? [];
		group.push(path);
		byCaseFoldedPath.set(folded, group);
	}
	for (const paths of byCaseFoldedPath.values()) {
		if (paths.length > 1) collisions.push({ type: "case", paths });
	}

	const paths = new Set(normalized);
	for (const path of normalized) {
		const parts = path.split("/");
		let parent = "";
		for (const part of parts.slice(0, -1)) {
			parent = parent ? `${parent}/${part}` : part;
			if (paths.has(parent)) collisions.push({ type: "fileFolder", paths: [parent, path] });
		}
	}
	return collisions;
}

export function assertNoPathCollisions(files: RemoteRevisionFile[]): void {
	const collisions = findPathCollisions(files);
	if (!collisions.length) return;
	const first = collisions[0];
	throw new Error(
		`${first.type === "case" ? "Filename case" : "File/folder"} collision: ${first.paths.join(" ↔ ")}`
	);
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").normalize("NFC").replace(/^\/+/, "");
}
