const HEX_RE = /^[0-9a-fA-F]{64}$/;

// TextEncoder always produces a fresh ArrayBuffer (never SharedArrayBuffer).
function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

// Constant-time hex comparison — avoids timing oracle on the secret list walk.
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let accum = 0;
  for (let i = 0; i < a.length; i++) {
    accum |= parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
  }
  return accum === 0;
}

async function hmacHex(secret: string, message: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifySignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  secrets: string[],
): Promise<boolean> {
  if (!signatureHeader || secrets.length === 0) return false;
  // Reject non-hex or wrong-length before constant-time comparison.
  if (!HEX_RE.test(signatureHeader)) return false;

  // Sign the raw request bytes directly — this is the documented signing contract.
  // Re-serializing through JSON.parse/stringify is wrong: any whitespace or escape
  // divergence between the sender's serializer and JS's JSON.stringify produces a
  // different byte sequence and causes 401s on legitimate deliveries.
  const bodyBuffer = rawBody.buffer instanceof ArrayBuffer
    ? (rawBody as Uint8Array<ArrayBuffer>)
    : (new Uint8Array(rawBody) as Uint8Array<ArrayBuffer>);

  for (const secret of secrets) {
    const expected = await hmacHex(secret, bodyBuffer);
    if (constantTimeEqualHex(expected, signatureHeader.toLowerCase())) {
      return true;
    }
  }
  return false;
}
