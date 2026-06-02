import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ntfy } from "../../src/providers/ntfy.js";
import type { Env, WebhookPayload } from "../../src/types.js";

const BASE_ENV: Env = {
  NTFY_TOPIC: "my-alerts",
};

const downPayload: WebhookPayload = {
  event: "down",
  monitor: { id: 1287, name: "myapp-healthz" },
  detected_at: "2026-04-12T14:23:11Z",
  evidence: { primary_error: "http_5xx", status_code: 503, region: "US-E" },
};

const upPayload: WebhookPayload = {
  event: "up",
  monitor: { id: 1287, name: "myapp-healthz" },
  detected_at: "2026-04-12T14:31:02Z",
  evidence: { primary_error: "", status_code: 200, region: "US-E" },
};

const killSwitchActivePayload: WebhookPayload = {
  event: "kill_switch_flipped",
  active: true,
  sentinel_path: "/var/lib/monitive/kill",
  detected_at: "2026-04-12T14:23:11Z",
  actor: "lucianmd",
};

const killSwitchInactivePayload: WebhookPayload = {
  event: "kill_switch_flipped",
  active: false,
  sentinel_path: "/var/lib/monitive/kill",
  detected_at: "2026-04-12T14:25:00Z",
};

const accountSuspendedPayload: WebhookPayload = {
  event: "account_suspended",
  account_id: 42,
  monitor_id: 0,
  reason: "payment_failed",
  detail: "Card expired",
  detected_at: "2026-04-12T14:23:11Z",
};

const capHitPayload: WebhookPayload = {
  event: "cap_hit",
  account_id: 42,
  monitor_id: 0,
  monitors_current: 10,
  detected_at: "2026-04-12T14:23:11Z",
};

const fleetUtilExceededPayload: WebhookPayload = {
  event: "fleet_util_exceeded",
  state: "breached",
  util: 0.95,
  window_hours: 24,
  detected_at: "2026-04-12T14:23:11Z",
};

const fleetUtilRecoveredPayload: WebhookPayload = {
  event: "fleet_util_recovered",
  state: "ok",
  util: 0.452,
  window_hours: 24,
  detected_at: "2026-04-12T14:23:11Z",
};

function parseHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
  return headers ?? {};
}

function parseBody(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls[0]?.[1]?.body as string ?? "";
}

function mockFetch(status: number, text = ""): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(new Response(text, { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ntfy — validateEnv", () => {
  it("throws when NTFY_TOPIC is missing", () => {
    expect(() => ntfy.validateEnv?.({})).toThrow("NTFY_TOPIC");
  });

  it("throws when NTFY_TOPIC is empty string", () => {
    expect(() => ntfy.validateEnv?.({ NTFY_TOPIC: "" })).toThrow("NTFY_TOPIC");
  });

  it("does not throw when NTFY_TOPIC is present", () => {
    expect(() => ntfy.validateEnv?.(BASE_ENV)).not.toThrow();
  });

  it("does not throw when NTFY_URL and NTFY_TOKEN are also present", () => {
    expect(() =>
      ntfy.validateEnv?.({ NTFY_TOPIC: "alerts", NTFY_URL: "https://ntfy.example.com", NTFY_TOKEN: "secret" }),
    ).not.toThrow();
  });
});

describe("ntfy — priority mapping", () => {
  it.each([
    ["down", downPayload, 5],
    ["up", upPayload, 3],
    ["kill_switch_flipped active=true", killSwitchActivePayload, 5],
    ["kill_switch_flipped active=false", killSwitchInactivePayload, 3],
    ["account_suspended", accountSuspendedPayload, 5],
    ["cap_hit", capHitPayload, 4],
    ["fleet_util_exceeded", fleetUtilExceededPayload, 4],
    ["fleet_util_recovered", fleetUtilRecoveredPayload, 3],
  ] as const)("%s → priority %i", async (_label, payload, expectedPriority) => {
    const fetchMock = mockFetch(200);
    await ntfy.send(payload, BASE_ENV);
    const headers = parseHeaders(fetchMock);
    expect(headers["Priority"]).toBe(String(expectedPriority));
  });
});

describe("ntfy — tags", () => {
  it.each([
    ["down", downPayload, "rotating_light"],
    ["up", upPayload, "white_check_mark"],
    ["kill_switch_flipped active=true", killSwitchActivePayload, "lock"],
    ["kill_switch_flipped active=false", killSwitchInactivePayload, "unlock"],
    ["account_suspended", accountSuspendedPayload, "no_entry"],
    ["cap_hit", capHitPayload, "chart_with_upwards_trend"],
    ["fleet_util_exceeded", fleetUtilExceededPayload, "warning"],
    ["fleet_util_recovered", fleetUtilRecoveredPayload, "white_check_mark"],
  ] as const)("%s → contains tag %s", async (_label, payload, expectedTag) => {
    const fetchMock = mockFetch(200);
    await ntfy.send(payload, BASE_ENV);
    const headers = parseHeaders(fetchMock);
    expect(headers["Tags"]).toContain(expectedTag);
  });
});

describe("ntfy — URL construction", () => {
  it("uses https://ntfy.sh/<topic> when NTFY_URL is not set", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, { NTFY_TOPIC: "my-alerts" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://ntfy.sh/my-alerts");
  });

  it("uses custom NTFY_URL with topic appended", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, { NTFY_TOPIC: "my-alerts", NTFY_URL: "https://ntfy.example.com" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://ntfy.example.com/my-alerts");
  });

  it("strips trailing slash from NTFY_URL to avoid double slash", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, { NTFY_TOPIC: "my-alerts", NTFY_URL: "https://ntfy.example.com/" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://ntfy.example.com/my-alerts");
  });

  it("strips multiple trailing slashes from NTFY_URL", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, { NTFY_TOPIC: "my-alerts", NTFY_URL: "https://ntfy.example.com///" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://ntfy.example.com/my-alerts");
  });
});

describe("ntfy — Authorization header", () => {
  it("includes Authorization header when NTFY_TOKEN is set", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, { ...BASE_ENV, NTFY_TOKEN: "my-secret" });
    const headers = parseHeaders(fetchMock);
    expect(headers["Authorization"]).toBe("Bearer my-secret");
  });

  it("omits Authorization header when NTFY_TOKEN is not set", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, BASE_ENV);
    const headers = parseHeaders(fetchMock);
    expect(headers["Authorization"]).toBeUndefined();
  });
});

describe("ntfy — outbound shape", () => {
  it("uses POST method", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, BASE_ENV);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("sends Title header", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, BASE_ENV);
    const headers = parseHeaders(fetchMock);
    expect(headers["Title"]).toBeDefined();
  });

  it("sends message as plain text body", async () => {
    const fetchMock = mockFetch(200);
    await ntfy.send(downPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(typeof body).toBe("string");
    expect(body.length).toBeGreaterThan(0);
  });

  it("truncates title over 250 chars", async () => {
    const longName = "a".repeat(300);
    const payload: WebhookPayload = { ...downPayload, monitor: { id: 1, name: longName } };
    const fetchMock = mockFetch(200);
    await ntfy.send(payload, BASE_ENV);
    const headers = parseHeaders(fetchMock);
    expect(Array.from(headers["Title"]!).length).toBeLessThanOrEqual(250);
  });
});

describe("ntfy — success and error paths", () => {
  it("returns { ok: true } on 2xx response", async () => {
    mockFetch(200);
    const result = await ntfy.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false, reason } on non-2xx response", async () => {
    mockFetch(503, "Service Unavailable");
    const result = await ntfy.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: false, reason: "ntfy 503: Service Unavailable" });
  });

  it("reason contains upstream status and body text", async () => {
    mockFetch(403, "forbidden");
    const result = await ntfy.send(downPayload, BASE_ENV);
    const r = result as { ok: false; reason: string };
    expect(r.reason).toContain("403");
    expect(r.reason).toContain("forbidden");
  });
});

describe("ntfy — Unicode-safe truncation", () => {
  it("does not emit lone surrogates when monitor name contains astral code points", async () => {
    // Each emoji is one astral code point = 2 UTF-16 code units. "[DOWN] " is 7 units + "x" = 8.
    // The naive slice(0, 249) cuts at offset 249-8 = 241 — an odd position inside the emoji run,
    // i.e. mid surrogate pair. The code-point implementation must not emit a lone surrogate.
    const longEmojiName = "x" + "🔥".repeat(260);
    const payload: WebhookPayload = { ...downPayload, monitor: { id: 1, name: longEmojiName } };
    const fetchMock = mockFetch(200);
    await ntfy.send(payload, BASE_ENV);
    const headers = parseHeaders(fetchMock);
    const title = headers["Title"]!;
    const noLoneSurrogate = Array.from(title).every((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp < 0xd800 || cp > 0xdfff;
    });
    expect(noLoneSurrogate).toBe(true);
    expect(Array.from(title).length).toBe(250);
  });
});
