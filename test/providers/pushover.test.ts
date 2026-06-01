import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushover } from "../../src/providers/pushover.js";
import type { Env, WebhookPayload } from "../../src/types.js";

const BASE_ENV: Env = {
  PUSHOVER_TOKEN: "test-token",
  PUSHOVER_USER: "test-user",
};

// Payloads for each event variant
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

function parseBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
  const result: Record<string, string> = {};
  for (const [k, v] of body.entries()) {
    result[k] = v;
  }
  return result;
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

describe("pushover — validateEnv", () => {
  it("throws when PUSHOVER_TOKEN is missing", () => {
    expect(() => pushover.validateEnv?.({ PUSHOVER_USER: "user" })).toThrow("PUSHOVER_TOKEN");
  });

  it("throws when PUSHOVER_USER is missing", () => {
    expect(() => pushover.validateEnv?.({ PUSHOVER_TOKEN: "tok" })).toThrow("PUSHOVER_USER");
  });

  it("throws when PUSHOVER_TOKEN is empty string", () => {
    expect(() => pushover.validateEnv?.({ PUSHOVER_TOKEN: "", PUSHOVER_USER: "user" })).toThrow("PUSHOVER_TOKEN");
  });

  it("throws when PUSHOVER_USER is empty string", () => {
    expect(() => pushover.validateEnv?.({ PUSHOVER_TOKEN: "tok", PUSHOVER_USER: "" })).toThrow("PUSHOVER_USER");
  });

  it("throws when PUSHOVER_TOKEN is whitespace only", () => {
    expect(() => pushover.validateEnv?.({ PUSHOVER_TOKEN: "   ", PUSHOVER_USER: "user" })).toThrow("PUSHOVER_TOKEN");
  });

  it("does not throw when both are present", () => {
    expect(() => pushover.validateEnv?.(BASE_ENV)).not.toThrow();
  });
});

describe("pushover — priority mapping", () => {
  it.each([
    ["down", downPayload, 2],
    ["up", upPayload, 0],
    ["kill_switch_flipped active=true", killSwitchActivePayload, 2],
    ["kill_switch_flipped active=false", killSwitchInactivePayload, 0],
    ["account_suspended", accountSuspendedPayload, 2],
    ["cap_hit", capHitPayload, 1],
    ["fleet_util_exceeded", fleetUtilExceededPayload, 1],
    ["fleet_util_recovered", fleetUtilRecoveredPayload, 0],
  ] as const)("%s → priority %i", async (_label, payload, expectedPriority) => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["priority"]).toBe(String(expectedPriority));
  });
});

describe("pushover — retry/expire", () => {
  it("includes retry and expire for priority 2 (down)", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(downPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["retry"]).toBe("30");
    expect(body["expire"]).toBe("1800");
  });

  it("includes retry and expire for priority 2 (kill_switch active)", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(killSwitchActivePayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["retry"]).toBe("30");
    expect(body["expire"]).toBe("1800");
  });

  it("omits retry and expire for priority 0 (up)", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(upPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["retry"]).toBeUndefined();
    expect(body["expire"]).toBeUndefined();
  });

  it("omits retry and expire for priority 1 (cap_hit)", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(capHitPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["retry"]).toBeUndefined();
    expect(body["expire"]).toBeUndefined();
  });
});

describe("pushover — outbound shape", () => {
  it("posts to the correct URL with correct method and content-type", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(downPayload, BASE_ENV);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pushover.net/1/messages.json",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/x-www-form-urlencoded" }),
      }),
    );
  });

  it("includes token, user, title, message, priority in body", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(downPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["token"]).toBe("test-token");
    expect(body["user"]).toBe("test-user");
    expect(body["title"]).toBeDefined();
    expect(body["message"]).toBeDefined();
    expect(body["priority"]).toBeDefined();
  });

  it("trims surrounding whitespace from token and user", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(downPayload, { PUSHOVER_TOKEN: "  padded-token  ", PUSHOVER_USER: "  padded-user  " });
    const body = parseBody(fetchMock);
    expect(body["token"]).toBe("padded-token");
    expect(body["user"]).toBe("padded-user");
  });

  it("truncates title over 250 chars", async () => {
    const longName = "a".repeat(300);
    const payload: WebhookPayload = { ...downPayload, monitor: { id: 1, name: longName } };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["title"]!.length).toBeLessThanOrEqual(250);
  });

  it("truncates message over 1024 chars", async () => {
    const longError = "e".repeat(2000);
    const payload: WebhookPayload = {
      ...downPayload,
      evidence: { ...downPayload.evidence, primary_error: longError },
    };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]!.length).toBeLessThanOrEqual(1024);
  });
});

describe("pushover — title formats", () => {
  it.each([
    ["down", downPayload, "[DOWN] myapp-healthz"],
    ["up", upPayload, "[UP] myapp-healthz"],
    ["kill_switch_flipped active=true", killSwitchActivePayload, "Kill Switch Activated"],
    ["kill_switch_flipped active=false", killSwitchInactivePayload, "Kill Switch Deactivated"],
    ["account_suspended", accountSuspendedPayload, "Account Suspended"],
    ["cap_hit", capHitPayload, "Monitor Cap Hit"],
    ["fleet_util_exceeded", fleetUtilExceededPayload, "Fleet Utilization Exceeded"],
    ["fleet_util_recovered", fleetUtilRecoveredPayload, "Fleet Utilization Recovered"],
  ] as const)("%s → title %s", async (_label, payload, expectedTitle) => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["title"]).toBe(expectedTitle);
  });
});

describe("pushover — success and error paths", () => {
  it("returns { ok: true } on success", async () => {
    mockFetch(200, JSON.stringify({ status: 1 }));
    const result = await pushover.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false, reason } on non-2xx response", async () => {
    mockFetch(503, "Service Unavailable");
    const result = await pushover.send(downPayload, BASE_ENV);
    expect(result).toEqual({ ok: false, reason: "pushover 503: Service Unavailable" });
  });

  it("reason contains upstream body text", async () => {
    mockFetch(400, "app token invalid");
    const result = await pushover.send(downPayload, BASE_ENV);
    expect((result as { ok: false; reason: string }).reason).toContain("app token invalid");
  });
});

describe("pushover — util rendering", () => {
  it("renders 0.95 as 95.0%", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(fleetUtilExceededPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]).toContain("95.0%");
  });

  it("renders 1.0 as 100.0%", async () => {
    const payload: WebhookPayload = { ...fleetUtilExceededPayload, util: 1.0 };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]).toContain("100.0%");
  });
});

describe("pushover — Unicode-safe truncation", () => {
  it("does not emit lone surrogates when monitor name contains astral code points", async () => {
    // Each emoji is an astral code point (2 UTF-16 code units). A name of 260 emojis
    // forces truncation and would produce a lone surrogate with the old slice() logic.
    const longEmojiName = "🔥".repeat(260);
    const payload: WebhookPayload = { ...downPayload, monitor: { id: 1, name: longEmojiName } };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    const title = body["title"]!;
    const noLoneSurrogate = Array.from(title).every((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp < 0xd800 || cp > 0xdfff;
    });
    expect(noLoneSurrogate).toBe(true);
    expect(title.length).toBeLessThanOrEqual(250 * 2); // at most 250 code points, each ≤2 UTF-16 units
    expect(Array.from(title).join("")).toBe(title); // round-trips cleanly
  });
});

describe("pushover — monitor_id sentinel (0)", () => {
  it("account_suspended omits #0 in message", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(accountSuspendedPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]).not.toContain("#0");
  });

  it("cap_hit omits #0 in message", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(capHitPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]).not.toContain("#0");
  });
});
