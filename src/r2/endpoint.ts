export interface ParsedR2Endpoint {
	endpoint: string;
	bucket?: string;
}

/**
 * Normalizes an R2 S3 endpoint. Cloudflare sometimes presents the bucket URL
 * with the bucket name appended; Isomite stores endpoint and bucket
 * separately because SigV4 path-style requests need both values.
 */
export function parseR2Endpoint(value: string): ParsedR2Endpoint | null {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}

	if (url.protocol !== "https:") return null;

	const segments = url.pathname
		.split("/")
		.filter(Boolean)
		.map((segment) => decodeURIComponent(segment));
	if (segments.length > 1) return null;

	return {
		endpoint: url.origin,
		bucket: segments[0],
	};
}
