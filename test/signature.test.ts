import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../src/auth.js";

// Semantically equivalent to the webhooks.md example:
// docs: JSON.stringify(req.body) (Express pre-parsed body)
// bridge: JSON.stringify(JSON.parse(raw)) — produces the same bytes for ASCII JSON
function referenceSign(secret: string, raw: Buffer): string {
  return createHmac("sha256", secret)
    .update(JSON.stringify(JSON.parse(raw.toString("utf8"))))
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
      // Assert round-trip stability — fixture must satisfy JSON.stringify(JSON.parse(raw)) === raw
      const roundTripped = JSON.stringify(JSON.parse(rawBuf.toString("utf8")));
      expect(roundTripped).toBe(rawBuf.toString("utf8"));

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
