export type UserErrorContext =
	| "connection"
	| "encryption"
	| "pairing-import"
	| "pairing-export"
	| "recovery-import"
	| "recovery-export"
	| "history"
	| "sync"
	| "sync-commit"
	| "sync-after-commit";

/** Removes JavaScript error-class prefixes from text shown outside diagnostics. */
export function errorMessage(error: unknown): string {
	return String(error).replace(/^[A-Za-z][A-Za-z0-9]*Error:\s*/, "").trim();
}

/** Explains what happened and gives the user one concrete next step. */
export function userErrorMessage(context: UserErrorContext, error: unknown): string {
	const detail = errorMessage(error);
	const lower = detail.toLowerCase();

	if (isClipboardFailure(lower, context)) {
		return context === "pairing-export"
			? "The pairing code could not be copied. Allow Obsidian to use the clipboard, then select Copy pairing code again."
			: "The recovery key could not be copied. Allow Obsidian to use the clipboard, then select Copy recovery key again.";
	}
	if (isNetworkFailure(lower)) {
		if (context === "sync-commit") {
			return "The connection dropped while Isomite was saving to R2, so it could not confirm whether the sync completed. Check your internet connection, then select Sync again; Isomite will verify the current state safely.";
		}
		return `Isomite could not reach R2. Check your internet connection and R2 endpoint, then ${retryAction(context)}.`;
	}
	if (isCredentialFailure(lower)) {
		return `R2 rejected the saved credentials. Re-enter the Access Key ID and Secret Access Key from a bucket-scoped read/write token, then ${retryAction(context)}.`;
	}
	if (isPermissionFailure(lower)) {
		return `The R2 token does not have permission to use this bucket. Give the token Object Read & Write access to this bucket, then ${retryAction(context)}.`;
	}
	if (isTemporaryR2Failure(lower)) {
		return `R2 is temporarily unavailable or busy. Wait a moment, then ${retryAction(context)}.`;
	}
	if (lower.includes("remote vault changed before") || lower.includes("remote head") && lower.includes("changed")) {
		return "Another device finished syncing first. Nothing from this attempt was committed; select Sync again to use the latest R2 version.";
	}
	if (lower.includes("file changed while scanning") || lower.includes("reviewed file changed") ||
		lower.includes("sync plan is stale") || lower.includes("file changed during upload")) {
		return "A local file changed while Isomite was scanning it. Nothing from this attempt was committed; wait for edits to finish, then select Sync again.";
	}
	if (lower.includes("older or divergent revision")) {
		return "R2 no longer contains the sync version remembered by this device. Check that this device uses the same R2 bucket as the others, then select Sync again.";
	}
	if (lower.includes("different isomite vault") || lower.includes("belongs to another vault")) {
		return "This device is connected to a different Isomite vault. Choose the correct R2 bucket or import a new pairing code from a connected device.";
	}
	if (lower.includes("pair this device before syncing")) {
		return "This bucket already contains an Isomite vault. Choose Pair to existing Isomite vault and import a pairing code from a connected device.";
	}
	if (isPassphraseFailure(lower)) {
		if (context === "recovery-import") {
			return "This recovery key cannot unlock the selected vault. Use the recovery key saved from this vault, then paste it again.";
		}
		if (context === "pairing-import") {
			return "This pairing code cannot unlock the selected vault. Copy a new pairing code from a connected device, then import it again.";
		}
		return "The saved passphrase cannot unlock this vault. Enter the original vault passphrase or import its recovery key, then verify encryption again.";
	}
	if (isPairingCodeFailure(lower)) {
		return "The pairing code is incomplete, invalid, or points to the wrong vault. Copy a new code from a connected device and paste the entire code again.";
	}
	if (lower.includes("pairing bucket is empty")) {
		return "The pairing code points to an empty bucket. Sync the original device first, then copy a new pairing code.";
	}
	if (lower.includes("already has sync state")) {
		return "This device is already connected to an Isomite vault, so another pairing code cannot be imported here. Keep the current connection, or pair the code in a fresh vault copy.";
	}
	if (lower.includes("credentials are incomplete")) {
		return "The saved R2 credentials are incomplete. Enter the Access Key ID and Secret Access Key, then try again.";
	}
	if (lower.includes("sync once before viewing history")) {
		return "This vault has no sync history yet. Complete the first Sync, then select View history again.";
	}
	if (isRecoveryKeyFailure(lower)) {
		return "The recovery key is incomplete or invalid. Copy the complete recovery key from where you saved it, then paste it again.";
	}
	if (lower.includes("dedicated empty bucket") || lower.includes("only be initialized in a dedicated empty bucket")) {
		return "This bucket already contains files, so Isomite will not initialize a new vault there. Choose a new empty bucket, or pair to the Isomite vault already in it.";
	}
	if (lower.includes("object not found") || lower.includes("sync data is missing")) {
		return "Part of this vault's sync data is missing from R2. Check that the correct bucket is selected and that its objects were not deleted or restored, then try again.";
	}
	if (isDamagedLocalState(lower)) {
		return "This device's saved sync recovery state is damaged. Do not reset the R2 bucket; make a fresh vault copy, pair it from a working device, and sync there.";
	}
	if (isDamagedSyncData(lower)) {
		return "The encrypted sync data in R2 is missing, damaged, or uses a different vault key. Stop syncing this bucket and restore it from a known-good backup, or initialize a new empty bucket from a known-good device.";
	}
	if (lower.includes("collision:")) {
		return `${detail}. Rename one of the listed files so their names and folders are unique, then select Sync again.`;
	}
	if (lower.includes("backup") && (lower.includes("did not finish") || lower.includes("failed"))) {
		return "Isomite could not create the required safety backup. Check available storage and vault write permission, then select Sync again.";
	}
	if (isLocalWriteFailure(lower)) {
		return committedSyncFailure(
			context,
			"This device could not finish writing a local file",
			"Check available storage and vault write permission, then select Sync again"
		);
	}
	if (isMissingSetupField(lower)) {
		return setupFieldMessage(lower, context);
	}

	return fallbackMessage(context);
}

function fallbackMessage(context: UserErrorContext): string {
	switch (context) {
		case "connection":
			return "The R2 connection could not be verified. Check the endpoint, bucket, credentials, and internet connection, then select Test connection again.";
		case "encryption":
			return "Vault encryption could not be verified. Check that the bucket and vault passphrase belong together, then select Verify encryption again.";
		case "pairing-import":
			return "This device could not be paired. Copy a new pairing code from a connected device, paste the entire code, then try again.";
		case "pairing-export":
			return "The pairing code could not be created. Sync this device and verify vault encryption, then select Copy pairing code again.";
		case "recovery-import":
			return "The recovery key could not unlock this vault. Check that the complete key belongs to this vault, then paste it again.";
		case "recovery-export":
			return "The recovery key could not be copied. Verify vault encryption, then select Copy recovery key again.";
		case "history":
			return "Sync history could not be loaded. Check the R2 connection, then select View history again.";
		case "sync-commit":
			return "Isomite could not confirm whether R2 saved this sync. Select Sync again; Isomite will verify the current state before changing anything.";
		case "sync-after-commit":
			return "R2 saved this sync, but this device could not finish applying it. Select Sync again; Isomite will resume safely before starting anything new.";
		case "sync":
			return "An unexpected problem stopped Sync before anything was committed. Reload Obsidian and select Sync again; if it repeats, update Isomite and report the issue.";
	}
}

function committedSyncFailure(context: UserErrorContext, what: string, next: string): string {
	return context === "sync-after-commit"
		? `R2 saved this sync, but ${what.toLowerCase()}. ${next}; Isomite will resume safely.`
		: `${what}. Nothing from this attempt was committed. ${next}.`;
}

function retryAction(context: UserErrorContext): string {
	switch (context) {
		case "connection": return "select Test connection again";
		case "encryption": return "select Verify encryption again";
		case "pairing-import": return "import the pairing code again";
		case "pairing-export": return "select Copy pairing code again";
		case "recovery-import": return "import the recovery key again";
		case "recovery-export": return "select Copy recovery key again";
		case "history": return "select View history again";
		case "sync":
		case "sync-commit":
		case "sync-after-commit": return "select Sync again";
	}
}

function setupFieldMessage(lower: string, context: UserErrorContext): string {
	if (lower.includes("endpoint")) return `The R2 endpoint is missing or invalid. Paste the HTTPS S3 API endpoint, then ${retryAction(context)}.`;
	if (lower.includes("bucket")) return `The R2 bucket name is missing. Enter the bucket name, then ${retryAction(context)}.`;
	if (lower.includes("access key id")) return `The R2 Access Key ID is missing. Enter it from your R2 token, then ${retryAction(context)}.`;
	if (lower.includes("secret access key")) return `The R2 Secret Access Key is missing. Enter it from your R2 token, then ${retryAction(context)}.`;
	return `The vault passphrase is missing. Enter a vault passphrase, then ${retryAction(context)}.`;
}

function isClipboardFailure(lower: string, context: UserErrorContext): boolean {
	return (context === "pairing-export" || context === "recovery-export") &&
		(lower.includes("clipboard") || lower.includes("notallowederror") || lower.includes("permission denied"));
}

function isNetworkFailure(lower: string): boolean {
	return ["failed to fetch", "load failed", "networkerror", "network error", "err_network", "net::", "timed out", "timeout", "socket", "dns"].some((part) => lower.includes(part));
}

function isCredentialFailure(lower: string): boolean {
	return lower.includes("invalidaccesskeyid") || lower.includes("signaturedoesnotmatch") || lower.includes("invalid access key") || lower.includes("http 401");
}

function isPermissionFailure(lower: string): boolean {
	return lower.includes("accessdenied") || lower.includes("http 403") || lower.includes("not authorized");
}

function isTemporaryR2Failure(lower: string): boolean {
	return lower.includes("http 429") || lower.includes("slowdown") || /http 5\d\d/.test(lower);
}

function isPassphraseFailure(lower: string): boolean {
	return lower.includes("passphrase does not match") || lower.includes("passphrase cannot unlock") || lower.includes("passphrase mismatch");
}

function isPairingCodeFailure(lower: string): boolean {
	return lower.includes("pairing code is invalid") || lower.includes("pairing vault id") ||
		lower.includes("pairing endpoint") || lower.includes("pairing destination") ||
		lower.includes("pairing code does not match");
}

function isRecoveryKeyFailure(lower: string): boolean {
	return lower.includes("malformed recovery key") || lower.includes("malformed base64 key material");
}

function isDamagedLocalState(lower: string): boolean {
	return lower.includes("local baseline") || lower.includes("local sync journal") ||
		lower.includes("encrypted isomite local state") || lower.includes("journal operation") ||
		lower.includes("journal hash");
}

function isDamagedSyncData(lower: string): boolean {
	return [
		"encrypted data is truncated",
		"unsupported isomite",
		"encrypted revision",
		"encrypted remote head",
		"failed content verification",
		"invalid json",
		"invalid sync",
		"content hash is invalid",
		"operationerror",
	].some((part) => lower.includes(part));
}

function isLocalWriteFailure(lower: string): boolean {
	return lower.includes("local write did not complete") || lower.includes("local write verification failed") ||
		lower.includes("local deletion did not complete") || lower.includes("recovery conflict copy");
}

function isMissingSetupField(lower: string): boolean {
	return lower.includes("enter the r2") || lower.includes("endpoint must") ||
		lower.includes("endpoint is not") || lower.includes("enter an encryption passphrase");
}
