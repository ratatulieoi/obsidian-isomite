export function errorMessage(error: unknown): string {
	if (error instanceof Error) return String(error).replace(/^[A-Za-z][A-Za-z0-9]*Error:\s*/, "");
	return String(error);
}
