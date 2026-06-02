import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { telegram } from "../../src/providers/telegram.js";
import type { Env, WebhookPayload } from "../../src/types.js";

const BASE_ENV: Env = {
  TELEGRAM_BOT_TOKEN: "123456:ABC-DEFtest",
  TELEGRAM_CHAT_ID: "-1001234567890",
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
  chat_id?: string;
  text?: string;
  parse_mode?: string;
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

describe("telegram — validateEnv", () => {
  it("throws when TELEGRAM_BOT_TOKEN is missing", () => {
    expect(() => telegram.validateEnv?.({ TELEGRAM_CHAT_ID: "-100123" })).toThrow("TELEGRAM_BOT_TOKEN");
  });

  it("throws when TELEGRAM_BOT_TOKEN is whitespace only", () => {
    expect(() => telegram.validateEnv?.({ TELEGRAM_BOT_TOKEN: "   ", TELEGRAM_CHAT_ID: "-100123" })).toThrow(
      "TELEGRAM_BOT_TOKEN",
    );
  });

  it("throws when TELEGRAM_CHAT_ID is missing", () => {
    expect(() => telegram.validateEnv?.({ TELEGRAM_BOT_TOKEN: "token" })).toThrow("TELEGRAM_CHAT_ID");
  });

  it("throws when TELEGRAM_CHAT_ID is whitespace only", () => {
    expect(() => telegram.validateEnv?.({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "   " })).toThrow(
      "TELEGRAM_CHAT_ID",
    );
  });

  it("does not throw when both vars are present", () => {
    expect(() => telegram.validateEnv?.(BASE_ENV)).not.toThrow();
  });
});

describe("telegram — text non-empty and chat_id correct for all events", () => {
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
  ] as const)("%s — text is non-empty and chat_id matches env", async (_label, payload) => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(payload, BASE_ENV);
    const json = parseJson(fetchMock);
    expect(typeof json.text).toBe("string");
    expect(json.text!.length).toBeGreaterThan(0);
    expect(json.chat_id).toBe(BASE_ENV.TELEGRAM_CHAT_ID);
  });
});

describe("telegram — no parse_mode field", () => {
  it("does not include parse_mode in the request body", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(downPayload, BASE_ENV);
    const json = parseJson(fetchMock);
    expect("parse_mode" in json).toBe(false);
  });
});

describe("telegram — Markdown metacharacters delivered verbatim", () => {
  it("monitor name with _ * [ ] ` metacharacters is not escaped", async () => {
    const name = "my_app *[test]* `code`";
    const payload: WebhookPayload = { ...downPayload, monitor_name: name };
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(payload, BASE_ENV);
    const json = parseJson(fetchMock);
    expect(json.text).toContain(name);
  });
});

describe("telegram — URL and chat_id placement", () => {
  it("URL contains the trimmed token", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    const token = "  123456:ABC-DEFtest  ";
    await telegram.send(downPayload, { ...BASE_ENV, TELEGRAM_BOT_TOKEN: token });
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`https://api.telegram.org/bot${token.trim()}/sendMessage`);
  });

  it("URL is exactly https://api.telegram.org/bot<token>/sendMessage", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(downPayload, BASE_ENV);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`https://api.telegram.org/bot${BASE_ENV.TELEGRAM_BOT_TOKEN}/sendMessage`);
  });

  it("chat_id is in the JSON body, not the URL", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(downPayload, BASE_ENV);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain(BASE_ENV.TELEGRAM_CHAT_ID!);
    const json = parseJson(fetchMock);
    expect(json.chat_id).toBe(BASE_ENV.TELEGRAM_CHAT_ID);
  });

  it("trims whitespace from TELEGRAM_CHAT_ID in the body", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    const chatId = "  -1001234567890  ";
    await telegram.send(downPayload, { ...BASE_ENV, TELEGRAM_CHAT_ID: chatId });
    const json = parseJson(fetchMock);
    expect(json.chat_id).toBe(chatId.trim());
  });
});

describe("telegram — success and error paths", () => {
  it("returns { ok: true } on 2xx response", async () => {
    mockFetch(200, '{"ok":true}');
    const result = await telegram.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false, reason } on non-2xx response", async () => {
    mockFetch(400, '{"ok":false,"error_code":400,"description":"Bad Request"}');
    const result = await telegram.send(downPayload, BASE_ENV);
    expect(result).toEqual({
      ok: false,
      reason: 'telegram 400: {"ok":false,"error_code":400,"description":"Bad Request"}',
    });
  });

  it("reason contains upstream status and body text", async () => {
    mockFetch(403, "forbidden");
    const result = await telegram.send(downPayload, BASE_ENV);
    const r = result as { ok: false; reason: string };
    expect(r.reason).toContain("403");
    expect(r.reason).toContain("forbidden");
  });
});

describe("telegram — monitor name and reason", () => {
  it("name absent → text contains 'Monitor #id is DOWN'", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(payload, BASE_ENV);
    expect(parseJson(fetchMock).text).toContain("Monitor #1287 is DOWN");
  });

  it("name present → text contains monitor_name", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(downPayload, BASE_ENV);
    expect(parseJson(fetchMock).text).toContain("myapp-healthz");
  });

  it("reason present → text contains reason", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(downPayload, BASE_ENV);
    expect(parseJson(fetchMock).text).toContain("http_5xx");
  });

  it("reason absent → text does not contain ' — '", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(payload, BASE_ENV);
    expect(parseJson(fetchMock).text).not.toContain(" — ");
  });

  it("flapping handled — telegram sends", async () => {
    const fetchMock = mockFetch(200, '{"ok":true}');
    const result = await telegram.send(flappingPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("telegram — truncation", () => {
  it("truncates text over 4096 code points", async () => {
    const longName = "a".repeat(5000);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longName };
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(payload, BASE_ENV);
    const json = parseJson(fetchMock);
    expect(Array.from(json.text!).length).toBeLessThanOrEqual(4096);
  });

  it("does not emit lone surrogates when monitor name contains astral code points", async () => {
    const longEmojiName = "x" + "🔥".repeat(4100);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longEmojiName };
    const fetchMock = mockFetch(200, '{"ok":true}');
    await telegram.send(payload, BASE_ENV);
    const text = parseJson(fetchMock).text!;
    const noLoneSurrogate = Array.from(text).every((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp < 0xd800 || cp > 0xdfff;
    });
    expect(noLoneSurrogate).toBe(true);
    expect(Array.from(text).length).toBe(4096);
  });
});
