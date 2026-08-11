import { describe, expect, it } from "vitest";
import { parseR2Endpoint } from "../src/r2/endpoint";

describe("parseR2Endpoint", () => {
	it("accepts a bare Cloudflare R2 endpoint", () => {
		expect(parseR2Endpoint("https://abc.r2.cloudflarestorage.com")).toEqual({
			endpoint: "https://abc.r2.cloudflarestorage.com",
			bucket: undefined,
		});
	});

	it("splits an endpoint that includes a bucket", () => {
		expect(parseR2Endpoint("https://abc.r2.cloudflarestorage.com/my-vault/")).toEqual({
			endpoint: "https://abc.r2.cloudflarestorage.com",
			bucket: "my-vault",
		});
	});

	it("rejects invalid, insecure, and multi-segment endpoints", () => {
		expect(parseR2Endpoint("not a URL")).toBeNull();
		expect(parseR2Endpoint("http://abc.r2.cloudflarestorage.com")).toBeNull();
		expect(parseR2Endpoint("https://abc.r2.cloudflarestorage.com/a/b")).toBeNull();
	});
});
