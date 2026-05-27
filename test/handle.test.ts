import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import type { Env } from "../src/types.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");
const MONITOR_SECRET = "monitor-secret";
const SECURITY_SECRET = "security-secret";

function sign(secret: string, raw: Buffer | string): string {
  const s = typeof raw === "string" ? raw : raw.toString("utf8");
  return createHmac("sha256", secret).update(JSON.stringify(JSON.parse(s))).digest("hex");
}

function makeRequest(
  method: string,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
): Request {
  const bodyBytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  // Cast Uint8Array to BodyInit — valid at runtime; TS DOM lib is overly strict about ArrayBufferLike.
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
  SECURITY_ALERT_WEBHOOK_SECRETS: SECURITY_SECRET,
};

describe("handle — monitor payload", () => {
  it("returns 200 with providersDispatched:0 for valid signed monitor-down", async () => {
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const res = await handle(req, baseEnv, raw);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["providersDispatched"]).toBe(0);
    expect(body["event"]).toBe("down");
  });

  it("returns 401 when signature mismatched", async () => {
    const { raw } = loadFixture("monitor-down.json");
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": "a".repeat(64) });
    const res = await handle(req, baseEnv, raw);
    expect(res.status).toBe(401);
  });

  it("returns 401 when monitor secret used for security payload", async () => {
    const { raw, buf } = loadFixture("security-kill-switch.json");
    // Sign with monitor secret — but env routes security payloads to security secret list
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const res = await handle(req, baseEnv, raw);
    expect(res.status).toBe(401);
  });
});

describe("handle — security payload", () => {
  it("returns 200 for valid signed security payload", async () => {
    const { raw, buf } = loadFixture("security-kill-switch.json");
    const sig = sign(SECURITY_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const res = await handle(req, baseEnv, raw);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["event"]).toBe("kill_switch_flipped");
  });

  it("returns 401 when security payload signed with monitor secret only", async () => {
    const { raw, buf } = loadFixture("security-kill-switch.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    // Only monitor secret configured — no security secret
    const res = await handle(req, { MONITOR_WEBHOOK_SECRETS: MONITOR_SECRET }, raw);
    expect(res.status).toBe(401);
  });
});

describe("handle — HTTP errors", () => {
  it("returns 405 for GET", async () => {
    const { raw } = loadFixture("monitor-down.json");
    const res = await handle(makeRequest("GET", raw), baseEnv, raw);
    expect(res.status).toBe(405);
  });

  it("returns 413 for 70 KB body", async () => {
    const big = new Uint8Array(70 * 1024).fill(65); // 70 KB of 'A'
    const res = await handle(makeRequest("POST", big), baseEnv, big);
    expect(res.status).toBe(413);
  });

  it("returns 400 for malformed JSON", async () => {
    const bad = new TextEncoder().encode("{not json");
    const res = await handle(makeRequest("POST", bad), baseEnv, bad);
    expect(res.status).toBe(400);
  });
});

describe("handle — missing secrets", () => {
  it("returns 401 when no monitor secrets configured", async () => {
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const res = await handle(req, {}, raw);
    expect(res.status).toBe(401);
  });
});
