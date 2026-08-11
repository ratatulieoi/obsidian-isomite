/**
 * WebCrypto accepts Uint8Array at runtime, while some TypeScript DOM
 * definitions require the narrower BufferSource shape.
 */
export function asBufferSource(bytes: Uint8Array): BufferSource {
	return bytes as unknown as BufferSource;
}
