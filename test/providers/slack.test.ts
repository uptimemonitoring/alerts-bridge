import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { slack } from "../../src/providers/slack.js";
import type { Env, WebhookPayload } from "../../src/types.js";

const BASE_ENV: Env = {
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/xxxx",
};

const downPayload: WebhookPayload = {
  event: "monitor.down",
  monitor_id: 1287,
  monitor_name: "myapp-healthz",
  occurred_at: "2026-04-12T14:23:11Z",
  reason: "http_5xx",
};

const upPayload: WebhookPayload = {
  event: "monitor.up",
  monitor_id: 1287,
  monitor_name: "myapp-healthz",
  occurred_at: "2026-04-12T14:31:02Z",
};

const flappingPayload: WebhookPayload = {
  event: "monitor.flapping",
  monitor_id: 1287,
  monitor_name: "myapp-healthz",
  occurred_at: "2026-04-12T14:35:00Z",
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

function parseBody(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls[0]?.[1]?.body as string ?? "";
}

function parseJson(fetchMock: ReturnType<typeof vi.fn>): {
  attachments?: Array<{ color?: string; title?: string; text?: string; fallback?: string }>;
} {
  return JSON.parse(parseBody(fetchMock) || "{}");
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

describe("slack — validateEnv", () => {
  it("throws when SLACK_WEBHOOK_URL is missing", () => {
    expect(() => slack.validateEnv?.({})).toThrow("SLACK_WEBHOOK_URL");
  });

  it("throws when SLACK_WEBHOOK_URL is empty string", () => {
    expect(() => slack.validateEnv?.({ SLACK_WEBHOOK_URL: "" })).toThrow("SLACK_WEBHOOK_URL");
  });

  it("throws when SLACK_WEBHOOK_URL is whitespace only", () => {
    expect(() => slack.validateEnv?.({ SLACK_WEBHOOK_URL: "   " })).toThrow("SLACK_WEBHOOK_URL");
  });

  it("does not throw when SLACK_WEBHOOK_URL is present", () => {
    expect(() => slack.validateEnv?.(BASE_ENV)).not.toThrow();
  });
});

describe("slack — color mapping", () => {
  it.each([
    ["monitor.down", downPayload, "danger"],
    ["monitor.up", upPayload, "good"],
    ["monitor.flapping", flappingPayload, "warning"],
    ["kill_switch_flipped active=true", killSwitchActivePayload, "danger"],
    ["kill_switch_flipped active=false", killSwitchInactivePayload, "good"],
    ["account_suspended", accountSuspendedPayload, "danger"],
    ["cap_hit", capHitPayload, "warning"],
    ["fleet_util_exceeded", fleetUtilExceededPayload, "warning"],
    ["fleet_util_recovered", fleetUtilRecoveredPayload, "good"],
  ] as const)("%s → color %s", async (_label, payload, expectedColor) => {
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    expect(parseJson(fetchMock).attachments?.[0]?.color).toBe(expectedColor);
  });
});

describe("slack — title and text non-empty", () => {
  it.each([
    ["monitor.down", downPayload],
    ["monitor.up", upPayload],
    ["monitor.flapping", flappingPayload],
    ["kill_switch_flipped active=true", killSwitchActivePayload],
    ["kill_switch_flipped active=false", killSwitchInactivePayload],
    ["account_suspended", accountSuspendedPayload],
    ["cap_hit", capHitPayload],
    ["fleet_util_exceeded", fleetUtilExceededPayload],
    ["fleet_util_recovered", fleetUtilRecoveredPayload],
  ] as const)("%s — title and text are non-empty strings", async (_label, payload) => {
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(typeof att?.title).toBe("string");
    expect(att!.title!.length).toBeGreaterThan(0);
    expect(typeof att?.text).toBe("string");
    expect(att!.text!.length).toBeGreaterThan(0);
  });
});

describe("slack — outbound shape", () => {
  it("uses POST method", async () => {
    const fetchMock = mockFetch(200);
    await slack.send(downPayload, BASE_ENV);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("sends Content-Type: application/json", async () => {
    const fetchMock = mockFetch(200);
    await slack.send(downPayload, BASE_ENV);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("POSTs to the exact SLACK_WEBHOOK_URL without path mutation", async () => {
    const fetchMock = mockFetch(200);
    await slack.send(downPayload, BASE_ENV);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(BASE_ENV.SLACK_WEBHOOK_URL);
  });

  it("trims whitespace from SLACK_WEBHOOK_URL", async () => {
    const fetchMock = mockFetch(200);
    const url = "https://hooks.slack.com/services/T000/B000/xxxx";
    await slack.send(downPayload, { SLACK_WEBHOOK_URL: `  ${url}  ` });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
  });

  it("body contains an attachments array", async () => {
    const fetchMock = mockFetch(200);
    await slack.send(downPayload, BASE_ENV);
    const json = parseJson(fetchMock);
    expect(Array.isArray(json.attachments)).toBe(true);
    expect(json.attachments!.length).toBe(1);
  });

  it("attachment has a fallback field", async () => {
    const fetchMock = mockFetch(200);
    await slack.send(downPayload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(typeof att?.fallback).toBe("string");
    expect(att!.fallback!.length).toBeGreaterThan(0);
  });
});

describe("slack — success and error paths", () => {
  it("returns { ok: true } on 2xx response", async () => {
    mockFetch(200);
    const result = await slack.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false, reason } on non-2xx response", async () => {
    mockFetch(503, "Service Unavailable");
    const result = await slack.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: false, reason: "slack 503: Service Unavailable" });
  });

  it("reason contains upstream status and body text", async () => {
    mockFetch(403, "forbidden");
    const result = await slack.send(downPayload, BASE_ENV);
    const r = result as { ok: false; reason: string };
    expect(r.reason).toContain("403");
    expect(r.reason).toContain("forbidden");
  });
});

describe("slack — monitor name and reason", () => {
  it("name absent → title uses Monitor #id", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(att?.title).toBe("[DOWN] Monitor #1287");
  });

  it("name absent → text contains 'Monitor #id is DOWN'", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(att?.text).toContain("Monitor #1287 is DOWN");
  });

  it("reason present → text contains reason", async () => {
    const fetchMock = mockFetch(200);
    await slack.send(downPayload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(att?.text).toContain("http_5xx");
  });

  it("reason absent → text does not contain ' — '", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(att?.text).not.toContain(" — ");
  });

  it("flapping handled — slack sends", async () => {
    const fetchMock = mockFetch(200);
    const result = await slack.send(flappingPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("slack — truncation", () => {
  it("truncates title over 250 code points", async () => {
    const longName = "a".repeat(300);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longName };
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(Array.from(att!.title!).length).toBeLessThanOrEqual(250);
  });

  it("truncates text over 3000 code points", async () => {
    const longName = "a".repeat(5000);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longName };
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    const att = parseJson(fetchMock).attachments?.[0];
    expect(Array.from(att!.text!).length).toBeLessThanOrEqual(3000);
  });

  it("does not emit lone surrogates when monitor name contains astral code points", async () => {
    // Each emoji is one astral code point = 2 UTF-16 code units. "[DOWN] " is 7 units + "x" = 8.
    // Naive string slicing at a UTF-16 offset can split a surrogate pair and emit a lone surrogate.
    const longEmojiName = "x" + "🔥".repeat(260);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longEmojiName };
    const fetchMock = mockFetch(200);
    await slack.send(payload, BASE_ENV);
    const title = parseJson(fetchMock).attachments?.[0]?.title!;
    const noLoneSurrogate = Array.from(title).every((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp < 0xd800 || cp > 0xdfff;
    });
    expect(noLoneSurrogate).toBe(true);
    expect(Array.from(title).length).toBe(250);
  });
});
