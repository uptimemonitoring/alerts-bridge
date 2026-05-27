import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../src/auth.js";

// Mirrors the Monitive signing contract: the HMAC is computed over the raw
// byte body as received over the wire — no JSON re-parsing or re-serialization.
// This is the source-of-truth reference.
function referenceSign(secret: string, raw: Buffer): string {
  return createHmac("sha256", secret)
    .update(raw)
    .digest("hex");
}

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");
const SECRET = "contractsecret";

const fixtures = [
  "monitor-down.json",
  "monitor-up.json",
  "security-kill-switch.json",
] as const;

describe("signature compatibility contract", () => {
  for (const fixture of fixtures) {
    it(`accepts reference-signed ${fixture}`, async () => {
      const rawBuf = readFileSync(join(FIXTURES_DIR, fixture));
      const raw = new Uint8Array(rawBuf);
      const sig = referenceSign(SECRET, rawBuf);
      expect(await verifySignature(raw, sig, [SECRET])).toBe(true);
    });

    it(`rejects a flipped-character signature for ${fixture}`, async () => {
      const rawBuf = readFileSync(join(FIXTURES_DIR, fixture));
      const raw = new Uint8Array(rawBuf);
      const sig = referenceSign(SECRET, rawBuf);
      // Flip the first character
      const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
      expect(await verifySignature(raw, flipped, [SECRET])).toBe(false);
    });
  }
});
