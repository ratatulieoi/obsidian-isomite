import { describe, expect, it } from "vitest";
import {
	decryptBytes,
	decryptContentBlob,
	deriveKeys,
	encryptBytes,
	encryptContentBlob,
	decryptSyncBlob,
	encryptSyncBlob,
	exportRecoveryKey,
	generateSaltBase64,
	hmacObjectKey,
	importRecoveryKey,
	keyedContentHash,
} from "../src/crypto/crypto";

describe("Isomite encryption", () => {
	it("derives deterministic independent keys", async () => {
		const salt = generateSaltBase64();
		const first = await deriveKeys("correct horse battery staple", salt);
		const second = await deriveKeys("correct horse battery staple", salt);
		const bytes = new TextEncoder().encode("note");

		expect(await keyedContentHash(first.contentHashKey, bytes)).toBe(
			await keyedContentHash(second.contentHashKey, bytes)
		);
		expect(await hmacObjectKey(first.pathHmacKey, "folder/note.md")).toBe(
			await hmacObjectKey(second.pathHmacKey, "folder/note.md")
		);
		expect(await keyedContentHash(first.contentHashKey, bytes)).not.toBe(
			await hmacObjectKey(first.pathHmacKey, "note")
		);
	});

	it("encrypts and decrypts bytes with AES-GCM", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const plaintext = new TextEncoder().encode("private note");
		const encrypted = await encryptBytes(keys.contentKey, plaintext);

		expect(encrypted).not.toEqual(plaintext);
		expect(new TextDecoder().decode(await decryptBytes(keys.contentKey, encrypted))).toBe("private note");
	});

	it("binds encrypted file content to its normalized path", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const plaintext = new TextEncoder().encode("private note");
		const encrypted = await encryptContentBlob(keys.contentKey, plaintext, "folder/note.md");

		expect(new TextDecoder().decode(await decryptContentBlob(keys.contentKey, encrypted, "folder/note.md"))).toBe(
			"private note"
		);
		await expect(decryptContentBlob(keys.contentKey, encrypted, "other/note.md")).rejects.toThrow();
	});

	it("binds immutable sync blobs to content hashes rather than paths", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const plaintext = new TextEncoder().encode("movable attachment");
		const contentHash = await keyedContentHash(keys.contentHashKey, plaintext);
		const encrypted = await encryptSyncBlob(keys.contentKey, plaintext, contentHash);

		expect(new TextDecoder().decode(await decryptSyncBlob(keys.contentKey, encrypted, contentHash))).toBe(
			"movable attachment"
		);
		await expect(decryptSyncBlob(keys.contentKey, encrypted, "ab".repeat(32))).rejects.toThrow();
	});

	it("exports and imports all recovery key material", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const recovered = await importRecoveryKey(await exportRecoveryKey(keys));
		const plaintext = new TextEncoder().encode("recover me");
		const encrypted = await encryptBytes(keys.contentKey, plaintext);

		expect(new TextDecoder().decode(await decryptBytes(recovered.contentKey, encrypted))).toBe("recover me");
		expect(await keyedContentHash(recovered.contentHashKey, plaintext)).toBe(
			await keyedContentHash(keys.contentHashKey, plaintext)
		);
	});

	it("normalizes equivalent Unicode paths before deriving object keys", async () => {
		const keys = await deriveKeys("passphrase", generateSaltBase64());
		const decomposed = "Cafe\u0301.md";
		const composed = "Caf\u00e9.md";

		expect(decomposed).not.toBe(composed);
		expect(await hmacObjectKey(keys.pathHmacKey, decomposed)).toBe(
			await hmacObjectKey(keys.pathHmacKey, composed)
		);
	});
});
