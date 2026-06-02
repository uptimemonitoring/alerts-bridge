import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import worker from "../../src/runtimes/cloudflare.js";
import type { Env } from "../../src/types.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "../fixtures");
const MONITOR_SECRET = "monitor-secret";

function sign(secret: string, raw: Buffer | Uint8Array): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

function makeRequest(
  method: string,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
): Request {
  const bodyBytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const bodyInit: BodyInit = bodyBytes as unknown as BodyInit;
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request("http://localhost/", {
    method,
    headers: new Headers({ "content-type": "application/json", ...headers }),
    ...(hasBody ? { body: bodyInit } : {}),
  });
}

function loadFixture(name: string): { raw: Uint8Array; buf: Buffer } {
  const buf = readFileSync(join(FIXTURES_DIR, name));
  return { raw: new Uint8Array(buf), buf };
}

const baseEnv: Env = {
  MONITOR_WEBHOOK_SECRETS: MONITOR_SECRET,
  SECURITY_ALERT_WEBHOOK_SECRETS: "security-secret",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cloudflare adapter — HTTP method enforcement", () => {
  it("returns 405 for GET", async () => {
    const { raw } = loadFixture("monitor-down.json");
    const res = await worker.fetch(makeRequest("GET", raw), baseEnv);
    expect(res.status).toBe(405);
  });
});

describe("cloudflare adapter — signature validation", () => {
  it("returns 401 when x-uptimemonitoring-signature is missing", async () => {
    const { raw } = loadFixture("monitor-down.json");
    const req = makeRequest("POST", raw);
    const res = await worker.fetch(req, baseEnv);
    expect(res.status).toBe(401);
  });

  it("returns 401 when x-uptimemonitoring-signature is invalid", async () => {
    const { raw } = loadFixture("monitor-down.json");
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": "a".repeat(64) });
    const res = await worker.fetch(req, baseEnv);
    expect(res.status).toBe(401);
  });
});

describe("cloudflare adapter — body size limit", () => {
  it("returns 413 for body larger than 64 KB", async () => {
    const big = new Uint8Array(70 * 1024).fill(65);
    const res = await worker.fetch(makeRequest("POST", big), baseEnv);
    expect(res.status).toBe(413);
  });
});

describe("cloudflare adapter — valid request dispatch", () => {
  it("returns 200 when request is valid and provider succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 1 }), { status: 200 })),
    );
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const env: Env = {
      ...baseEnv,
      PROVIDER: "pushover",
      PUSHOVER_TOKEN: "test-token",
      PUSHOVER_USER: "test-user",
    };
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["providersDispatched"]).toBe(1);
  });
});

describe("cloudflare adapter — raw body preservation", () => {
  it("passes raw bytes to handle() unmodified (signature verifies end-to-end)", async () => {
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    // No provider configured — just verifies signature passes through correctly
    const res = await worker.fetch(req, baseEnv);
    // 200 with no providers means the signature was accepted: the adapter passed
    // the raw bytes through unmodified, so the HMAC computed over them matched.
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["providersDispatched"]).toBe(0);
  });
});
