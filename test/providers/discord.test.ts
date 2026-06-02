import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discord } from "../../src/providers/discord.js";
import type { Env, WebhookPayload } from "../../src/types.js";

const BASE_ENV: Env = {
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/000/xxxx",
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
  sentinel_path: "/var/lib/example/kill",
  detected_at: "2026-04-12T14:23:11Z",
  actor: "admin",
};

const killSwitchInactivePayload: WebhookPayload = {
  event: "kill_switch_flipped",
  active: false,
  sentinel_path: "/var/lib/example/kill",
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
  embeds?: Array<{ color?: number; title?: string; description?: string }>;
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

describe("discord — validateEnv", () => {
  it("throws when DISCORD_WEBHOOK_URL is missing", () => {
    expect(() => discord.validateEnv?.({})).toThrow("DISCORD_WEBHOOK_URL");
  });

  it("throws when DISCORD_WEBHOOK_URL is empty string", () => {
    expect(() => discord.validateEnv?.({ DISCORD_WEBHOOK_URL: "" })).toThrow("DISCORD_WEBHOOK_URL");
  });

  it("throws when DISCORD_WEBHOOK_URL is whitespace only", () => {
    expect(() => discord.validateEnv?.({ DISCORD_WEBHOOK_URL: "   " })).toThrow("DISCORD_WEBHOOK_URL");
  });

  it("does not throw when DISCORD_WEBHOOK_URL is present", () => {
    expect(() => discord.validateEnv?.(BASE_ENV)).not.toThrow();
  });
});

describe("discord — color mapping", () => {
  it.each([
    ["monitor.down", downPayload, 0xE01E5A],
    ["monitor.up", upPayload, 0x2EB67D],
    ["monitor.flapping", flappingPayload, 0xF2C744],
    ["kill_switch_flipped active=true", killSwitchActivePayload, 0xE01E5A],
    ["kill_switch_flipped active=false", killSwitchInactivePayload, 0x2EB67D],
    ["account_suspended", accountSuspendedPayload, 0xE01E5A],
    ["cap_hit", capHitPayload, 0xF2C744],
    ["fleet_util_exceeded", fleetUtilExceededPayload, 0xF2C744],
    ["fleet_util_recovered", fleetUtilRecoveredPayload, 0x2EB67D],
  ] as const)("%s → color %s", async (_label, payload, expectedColor) => {
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    expect(parseJson(fetchMock).embeds?.[0]?.color).toBe(expectedColor);
  });
});

describe("discord — title and description non-empty", () => {
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
  ] as const)("%s — title and description are non-empty strings", async (_label, payload) => {
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    const embed = parseJson(fetchMock).embeds?.[0];
    expect(typeof embed?.title).toBe("string");
    expect(embed!.title!.length).toBeGreaterThan(0);
    expect(typeof embed?.description).toBe("string");
    expect(embed!.description!.length).toBeGreaterThan(0);
  });
});

describe("discord — outbound shape", () => {
  it("uses POST method", async () => {
    const fetchMock = mockFetch(200);
    await discord.send(downPayload, BASE_ENV);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("sends Content-Type: application/json", async () => {
    const fetchMock = mockFetch(200);
    await discord.send(downPayload, BASE_ENV);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("POSTs to the exact DISCORD_WEBHOOK_URL without path mutation", async () => {
    const fetchMock = mockFetch(200);
    await discord.send(downPayload, BASE_ENV);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(BASE_ENV.DISCORD_WEBHOOK_URL);
  });

  it("trims whitespace from DISCORD_WEBHOOK_URL", async () => {
    const fetchMock = mockFetch(200);
    const url = "https://discord.com/api/webhooks/000/xxxx";
    await discord.send(downPayload, { DISCORD_WEBHOOK_URL: `  ${url}  ` });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
  });

  it("body contains an embeds array with one element", async () => {
    const fetchMock = mockFetch(200);
    await discord.send(downPayload, BASE_ENV);
    const json = parseJson(fetchMock);
    expect(Array.isArray(json.embeds)).toBe(true);
    expect(json.embeds!.length).toBe(1);
  });
});

describe("discord — success and error paths", () => {
  it("returns { ok: true } on 2xx response", async () => {
    mockFetch(200);
    const result = await discord.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false, reason } on non-2xx response", async () => {
    mockFetch(503, "Service Unavailable");
    const result = await discord.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: false, reason: "discord 503: Service Unavailable" });
  });

  it("reason contains upstream status and body text", async () => {
    mockFetch(403, "forbidden");
    const result = await discord.send(downPayload, BASE_ENV);
    const r = result as { ok: false; reason: string };
    expect(r.reason).toContain("403");
    expect(r.reason).toContain("forbidden");
  });
});

describe("discord — monitor name and reason", () => {
  it("name absent → title uses Monitor #id", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    const embed = parseJson(fetchMock).embeds?.[0];
    expect(embed?.title).toBe("[DOWN] Monitor #1287");
  });

  it("name absent → description contains 'Monitor #id is DOWN'", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    const embed = parseJson(fetchMock).embeds?.[0];
    expect(embed?.description).toContain("Monitor #1287 is DOWN");
  });

  it("reason present → description contains reason", async () => {
    const fetchMock = mockFetch(200);
    await discord.send(downPayload, BASE_ENV);
    const embed = parseJson(fetchMock).embeds?.[0];
    expect(embed?.description).toContain("http_5xx");
  });

  it("reason absent → description does not contain ' — '", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    const embed = parseJson(fetchMock).embeds?.[0];
    expect(embed?.description).not.toContain(" — ");
  });

  it("flapping handled — discord sends", async () => {
    const fetchMock = mockFetch(200);
    const result = await discord.send(flappingPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("discord — truncation", () => {
  it("truncates title over 256 code points", async () => {
    const longName = "a".repeat(300);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longName };
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    const embed = parseJson(fetchMock).embeds?.[0];
    expect(Array.from(embed!.title!).length).toBeLessThanOrEqual(256);
  });

  it("truncates description over 4096 code points", async () => {
    const longName = "a".repeat(5000);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longName };
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    const embed = parseJson(fetchMock).embeds?.[0];
    expect(Array.from(embed!.description!).length).toBeLessThanOrEqual(4096);
  });

  it("does not emit lone surrogates when monitor name contains astral code points", async () => {
    // Each emoji is one astral code point = 2 UTF-16 code units. "[DOWN] " is 7 units + "x" = 8.
    // Naive string slicing at a UTF-16 offset can split a surrogate pair and emit a lone surrogate.
    const longEmojiName = "x" + "🔥".repeat(260);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longEmojiName };
    const fetchMock = mockFetch(200);
    await discord.send(payload, BASE_ENV);
    const title = parseJson(fetchMock).embeds?.[0]?.title!;
    const noLoneSurrogate = Array.from(title).every((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp < 0xd800 || cp > 0xdfff;
    });
    expect(noLoneSurrogate).toBe(true);
    expect(Array.from(title).length).toBe(256);
  });
});
