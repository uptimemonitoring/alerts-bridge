import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handle } from "../src/index.js";
import { providers } from "../src/providers/index.js";
import type { Env } from "../src/types.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");
const MONITOR_SECRET = "monitor-secret";
const SECURITY_SECRET = "security-secret";

function sign(secret: string, raw: Buffer | Uint8Array): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
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
    expect(body["event"]).toBe("monitor.down");
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

describe("handle — provider dispatch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pushoverEnv: Env = {
    ...baseEnv,
    PROVIDER: "pushover",
    PUSHOVER_TOKEN: "test-token",
    PUSHOVER_USER: "test-user",
  };

  it("returns 200 with empty results when no providers configured", async () => {
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const res = await handle(req, baseEnv, raw);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["providersDispatched"]).toBe(0);
    expect(body["providersFailed"]).toBe(0);
    expect(body["results"]).toEqual([]);
    expect(body["note"]).toBe("no providers configured");
  });

  it("dispatches to pushover and returns 200 with providersDispatched:1", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 1 }), { status: 200 }));
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const res = await handle(req, pushoverEnv, raw);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["providersDispatched"]).toBe(1);
    expect(body["providersFailed"]).toBe(0);
    const results = body["results"] as Array<Record<string, unknown>>;
    expect(results[0]).toEqual({ provider: "pushover", ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("api.pushover.net"),
      expect.any(Object),
    );
  });

  it("returns 500 when pushover returns 503", async () => {
    fetchMock.mockResolvedValue(new Response("server error", { status: 503 }));
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const res = await handle(req, pushoverEnv, raw);
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(false);
    expect(body["failures"]).toEqual(["pushover"]);
    expect(body["succeeded"]).toEqual([]);
    const results = body["results"] as Array<Record<string, unknown>>;
    expect(String(results[0]?.["reason"])).toContain("503");
  });

  it("returns 500 when one of two providers fails (P1 partial failure)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 1 }), { status: 200 }));
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    providers["fakefail"] = {
      name: "fakefail",
      async send() { return { ok: false, reason: "simulated failure" }; },
    };
    let res: Response;
    try {
      const env: Env = { ...pushoverEnv, PROVIDER: "pushover,fakefail" };
      res = await handle(req, env, raw);
    } finally {
      delete providers["fakefail"];
    }
    expect(res!.status).toBe(500);
    const body = await res!.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(false);
    expect(body["failures"]).toEqual(["fakefail"]);
    expect(body["succeeded"]).toEqual(["pushover"]);
  });

  it("rejects with ConfigError for unknown provider name (P2-2)", async () => {
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const env: Env = { ...baseEnv, PROVIDER: "nonexistent" };
    await expect(handle(req, env, raw)).rejects.toThrow("Unknown provider");
  });

  it("returns 401 for bad signature even when PUSHOVER_TOKEN is missing (P2-3)", async () => {
    const { raw } = loadFixture("monitor-down.json");
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": "a".repeat(64) });
    const env: Env = { ...baseEnv, PROVIDER: "pushover" }; // no PUSHOVER_TOKEN
    const res = await handle(req, env, raw);
    expect(res.status).toBe(401);
  });

  it("throws when pushover configured but PUSHOVER_TOKEN missing", async () => {
    const { raw, buf } = loadFixture("monitor-down.json");
    const sig = sign(MONITOR_SECRET, buf);
    const req = makeRequest("POST", raw, { "x-uptimemonitoring-signature": sig });
    const env: Env = { ...baseEnv, PROVIDER: "pushover", PUSHOVER_USER: "user-key" };
    await expect(handle(req, env, raw)).rejects.toThrow("PUSHOVER_TOKEN");
  });
});
