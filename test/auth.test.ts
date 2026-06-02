import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../src/auth.js";

function sign(secret: string, raw: Uint8Array | Buffer | string): string {
  const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
  return createHmac("sha256", secret)
    .update(bytes)
    .digest("hex");
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const PAYLOAD = '{"event":"monitor.down","monitor_id":1,"occurred_at":"2026-01-01T00:00:00Z","monitor_name":"x","reason":"http_5xx"}';
const SECRET = "testsecret";
const RAW = utf8(PAYLOAD);
const SIG = sign(SECRET, RAW);

describe("verifySignature", () => {
  it("accepts a valid signature with a single secret", async () => {
    expect(await verifySignature(RAW, SIG, [SECRET])).toBe(true);
  });

  it("accepts when matching secret is 3rd in list", async () => {
    expect(await verifySignature(RAW, SIG, ["wrong1", "wrong2", SECRET])).toBe(true);
  });

  it("rejects a bad signature", async () => {
    const bad = SIG.replace(/[0-9a-f]/, (c) => (c === "f" ? "0" : "f"));
    expect(await verifySignature(RAW, bad, [SECRET])).toBe(false);
  });

  it("rejects a null header", async () => {
    expect(await verifySignature(RAW, null, [SECRET])).toBe(false);
  });

  it("rejects an empty string header", async () => {
    expect(await verifySignature(RAW, "", [SECRET])).toBe(false);
  });

  it("rejects a non-hex character in the signature (P2 security regression)", async () => {
    // Replace a '0' nibble with 'z' — parseInt('z', 16) is NaN, coerces to 0 in bitwise ops
    const withNonHex = SIG.replace("0", "z");
    expect(await verifySignature(RAW, withNonHex, [SECRET])).toBe(false);
  });

  it("rejects payload tampering", async () => {
    const tampered = utf8(PAYLOAD.slice(0, -1) + "X");
    expect(await verifySignature(tampered, SIG, [SECRET])).toBe(false);
  });

  it("rejects an empty secret list", async () => {
    expect(await verifySignature(RAW, SIG, [])).toBe(false);
  });

  it("accepts a security alert payload with the security secret", async () => {
    const secPayload = '{"event":"kill_switch_flipped","active":true,"sentinel_path":"/x","detected_at":"2026-01-01T00:00:00Z"}';
    const secSecret = "security-secret";
    const secRaw = utf8(secPayload);
    const secSig = sign(secSecret, secRaw);
    expect(await verifySignature(secRaw, secSig, [secSecret])).toBe(true);
  });

  it("rejects a security payload verified against a monitor-only secret", async () => {
    const secPayload = '{"event":"kill_switch_flipped","active":true,"sentinel_path":"/x","detected_at":"2026-01-01T00:00:00Z"}';
    const monitorSecret = "monitor-secret";
    const secRaw = utf8(secPayload);
    const secSig = sign("security-secret", secRaw);
    expect(await verifySignature(secRaw, secSig, [monitorSecret])).toBe(false);
  });

  it("rejects a signature that is too short", async () => {
    expect(await verifySignature(RAW, SIG.slice(0, 32), [SECRET])).toBe(false);
  });

  it("rejects a signature that is too long", async () => {
    expect(await verifySignature(RAW, SIG + "aa", [SECRET])).toBe(false);
  });
});
