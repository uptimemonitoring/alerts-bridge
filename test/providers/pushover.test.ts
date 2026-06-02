import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushover } from "../../src/providers/pushover.js";
import type { Env, WebhookPayload } from "../../src/types.js";

const BASE_ENV: Env = {
  PUSHOVER_TOKEN: "test-token",
  PUSHOVER_USER: "test-user",
};

// Payloads for each event variant
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
    ["monitor.down", downPayload, 2],
    ["monitor.up", upPayload, 0],
    ["monitor.flapping", flappingPayload, 1],
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
    const payload: WebhookPayload = { ...downPayload, monitor_name: longName };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["title"]!.length).toBeLessThanOrEqual(250);
  });

  it("truncates message over 1024 chars", async () => {
    const longReason = "e".repeat(2000);
    const payload: WebhookPayload = { ...downPayload, reason: longReason };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]!.length).toBeLessThanOrEqual(1024);
  });
});

describe("pushover — title formats", () => {
  it.each([
    ["monitor.down", downPayload, "[DOWN] myapp-healthz"],
    ["monitor.up", upPayload, "[UP] myapp-healthz"],
    ["monitor.flapping", flappingPayload, "[FLAPPING] myapp-healthz"],
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
    // Each emoji is one astral code point = 2 UTF-16 code units. The down title is
    // `[DOWN] ` + name. We prepend a single ASCII char to the name so the emoji run
    // starts at an EVEN UTF-16 offset (`[DOWN] ` is 7 units + "x" = 8). The naive
    // slice(0, TITLE_MAX - 1) = slice(0, 249) then cuts at offset 249-8 = 241 — an
    // ODD position inside the emoji run, i.e. mid surrogate pair. So the old
    // string-slice implementation WOULD emit a lone surrogate here; the code-point
    // implementation must not. This parity is what makes the test catch the bug.
    const longEmojiName = "x" + "🔥".repeat(260);
    const payload: WebhookPayload = { ...downPayload, monitor_name: longEmojiName };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    const title = body["title"]!;
    const noLoneSurrogate = Array.from(title).every((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp < 0xd800 || cp > 0xdfff;
    });
    expect(noLoneSurrogate).toBe(true);
    // Code-point cap: TITLE_MAX-1 retained code points + the "…" ellipsis = exactly 250.
    expect(Array.from(title).length).toBe(250);
  });
});

describe("pushover — monitor name and reason", () => {
  it("name absent → title uses Monitor #id", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["title"]).toBe("[DOWN] Monitor #1287");
  });

  it("name absent → message contains 'Monitor #id is DOWN'", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]).toContain("Monitor #1287 is DOWN");
  });

  it("name present → title uses monitor_name", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(downPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["title"]).toBe("[DOWN] myapp-healthz");
  });

  it("reason present → message contains reason", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(downPayload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]).toContain("http_5xx");
  });

  it("reason absent → message does not contain ' — '", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    await pushover.send(payload, BASE_ENV);
    const body = parseBody(fetchMock);
    expect(body["message"]).not.toContain(" — ");
  });

  it("flapping handled by all providers — pushover sends", async () => {
    const fetchMock = mockFetch(200, JSON.stringify({ status: 1 }));
    const result = await pushover.send(flappingPayload, BASE_ENV);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalled();
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

describe("pushover — occurred_at in monitor message", () => {
  it("includes the detected timestamp in a down alert", async () => {
    const payload: WebhookPayload = { event: "monitor.down", monitor_id: 1287, occurred_at: "2026-04-12T14:23:11Z" };
    const fetchMock = mockFetch(200);
    await pushover.send(payload, BASE_ENV);
    expect(parseBody(fetchMock)["message"]).toContain("2026-04-12T14:23:11Z");
  });
});
