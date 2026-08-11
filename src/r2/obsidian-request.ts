import { requestUrl } from "obsidian";
import type { R2Transport } from "./r2-client";

/**
 * Obsidian's requestUrl API works on desktop and mobile and is not blocked by
 * browser CORS rules, unlike renderer-level fetch requests to private R2
 * endpoints.
 */
export const obsidianR2Transport: R2Transport = async (url, init) => {
	const response = await requestUrl({
		url,
		method: init.method,
		headers: init.headers,
		body: init.body ? toArrayBuffer(init.body) : undefined,
		throw: false,
	});

	return {
		status: response.status,
		text: response.text,
	};
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
