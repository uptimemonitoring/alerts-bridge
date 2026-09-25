import { describe, expect, it } from "vitest";
import { validate } from "../src/validate.js";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function makeReq(
  method: string,
  body: string | Uint8Array,
  headers: Record<string, string> = {},
): Request {
  const h = new Headers({ "content-type": "application/json", ...headers });
  // Cast Uint8Array to BodyInit — valid at runtime; TS DOM lib is overly strict about ArrayBufferLike.
  const bodyInit: BodyInit = typeof body === "string" ? body : (body as unknown as BodyInit);
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request("http://localhost/", { method, headers: h, ...(hasBody ? { body: bodyInit } : {}) });
}

const MONITOR_DOWN = '{"event":"monitor.down","monitor_id":1287,"occurred_at":"2026-04-12T14:23:11Z","reason":"http_5xx","monitor_name":"myapp-healthz"}';
const MONITOR_UP   = '{"event":"monitor.up","monitor_id":1287,"occurred_at":"2026-04-12T14:31:02Z","monitor_name":"myapp-healthz"}';
const KILL_SWITCH  = '{"event":"kill_switch_flipped","active":true,"sentinel_path":"/var/lib/example/kill","detected_at":"2026-04-12T14:23:11Z","actor":"admin"}';

describe("validate — method", () => {
  it("rejects GET with 405", () => {
    const r = validate(makeReq("GET", MONITOR_DOWN), utf8(MONITOR_DOWN));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(405);
  });
});

describe("validate — content-type", () => {
  it("rejects missing content-type with 415", () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: new Headers({}),
      body: MONITOR_DOWN,
    });
    const r = validate(req, utf8(MONITOR_DOWN));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  it("rejects text/plain with 415", () => {
    const r = validate(makeReq("POST", MONITOR_DOWN, { "content-type": "text/plain" }), utf8(MONITOR_DOWN));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  it("accepts application/json; charset=utf-8", () => {
    const r = validate(
      makeReq("POST", MONITOR_DOWN, { "content-type": "application/json; charset=utf-8" }),
      utf8(MONITOR_DOWN),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects application/jsonx with 415 (P2 security regression)", () => {
    const r = validate(
      makeReq("POST", MONITOR_DOWN, { "content-type": "application/jsonx" }),
      utf8(MONITOR_DOWN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  it("rejects application/json-patch+json with 415 (P2 security regression)", () => {
    const r = validate(
      makeReq("POST", MONITOR_DOWN, { "content-type": "application/json-patch+json" }),
      utf8(MONITOR_DOWN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });
});

describe("validate — body size", () => {
  it("rejects 65537 bytes with 413", () => {
    const big = utf8("x".repeat(65537));
    const r = validate(makeReq("POST", big), big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });

  it("rejects when Content-Length > 65536 even if raw is smaller", () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "content-length": "65537" }),
      body: MONITOR_DOWN,
    });
    const r = validate(req, utf8(MONITOR_DOWN));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });

  it("accepts exactly 65536 bytes when valid JSON (boundary)", () => {
    const base = '{"event":"monitor.down","monitor_id":1,"occurred_at":"2026-01-01T00:00:00Z","monitor_name":"';
    const suffix = '"}';
    const padding = "x".repeat(65536 - base.length - suffix.length);
    const big = base + padding + suffix;
    expect(big.length).toBe(65536);
    const r = validate(makeReq("POST", big), utf8(big));
    expect(r.ok).toBe(true);
  });
});

describe("validate — JSON parsing", () => {
  it("rejects malformed JSON with 400", () => {
    const bad = utf8("{not json");
    const r = validate(makeReq("POST", bad), bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("validate — event discriminator", () => {
  it("rejects unknown event with 400", () => {
    const body = '{"event":"exploded","foo":"bar"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/unknown event/);
    }
  });
});

describe("validate — monitor payload validation", () => {
  it("rejects missing monitor_id with 400", () => {
    const body = '{"event":"monitor.down","occurred_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects non-RFC3339 occurred_at with 400", () => {
    const body = '{"event":"monitor.down","monitor_id":1,"occurred_at":"yesterday"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/RFC3339/);
    }
  });

  it("rejects fractional monitor_id (P2 migration regression)", () => {
    const body = '{"event":"monitor.down","monitor_id":1.5,"occurred_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("accepts a valid monitor-down payload", () => {
    const r = validate(makeReq("POST", MONITOR_DOWN), utf8(MONITOR_DOWN));
    expect(r.ok).toBe(true);
  });

  it("accepts a valid monitor-up payload", () => {
    const r = validate(makeReq("POST", MONITOR_UP), utf8(MONITOR_UP));
    expect(r.ok).toBe(true);
  });

  it("accepts monitor.flapping without optional fields", () => {
    const body = '{"event":"monitor.flapping","monitor_id":30,"occurred_at":"2026-04-12T14:35:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });

  it("accepts monitor-down with all optional fields present", () => {
    const body = '{"event":"monitor.down","monitor_id":30,"occurred_at":"2026-04-12T14:23:11Z","monitor_name":"myapp","monitor_url":"https://example.com","reason":"http_5xx","account_id":1,"delivery_id":3,"attempt":1}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });
});

describe("validate — security payload validation", () => {
  it("rejects kill_switch_flipped missing sentinel_path with 400", () => {
    const body = '{"event":"kill_switch_flipped","active":true,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("accepts a valid kill_switch_flipped payload", () => {
    const r = validate(makeReq("POST", KILL_SWITCH), utf8(KILL_SWITCH));
    expect(r.ok).toBe(true);
  });

  it("accepts account_suspended payload", () => {
    const body = '{"event":"account_suspended","account_id":42,"monitor_id":0,"reason":"fraud","detail":"d","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });

  it("accepts account_suspension_failed payload", () => {
    const body = '{"event":"account_suspension_failed","account_id":42,"monitor_id":0,"reason":"dns_rebinding","detail":"Confirmed DNS-rebinding detection","error":"suspension rollback: db timeout","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
    if (r.ok && r.payload.event === "account_suspension_failed") {
      expect(r.payload.error).toBe("suspension rollback: db timeout");
    }
  });

  it("rejects account_suspension_failed missing error with 400", () => {
    const body = '{"event":"account_suspension_failed","account_id":42,"monitor_id":0,"reason":"dns_rebinding","detail":"Confirmed DNS-rebinding detection","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/error/);
    }
  });

  it("rejects account_suspension_failed with non-string error with 400", () => {
    const body = '{"event":"account_suspension_failed","account_id":42,"monitor_id":0,"reason":"dns_rebinding","detail":"Confirmed DNS-rebinding detection","error":123,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/error/);
    }
  });

  it("rejects account_suspension_failed missing reason with 400", () => {
    const body = '{"event":"account_suspension_failed","account_id":42,"monitor_id":0,"detail":"Confirmed DNS-rebinding detection","error":"db timeout","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects account_suspension_failed missing detected_at with 400", () => {
    const body = '{"event":"account_suspension_failed","account_id":42,"monitor_id":0,"reason":"dns_rebinding","detail":"d","error":"db timeout"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("accepts cap_hit payload", () => {
    const body = '{"event":"cap_hit","account_id":42,"monitor_id":1,"monitors_current":100,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });

  it("accepts fleet_util_exceeded payload", () => {
    const body = '{"event":"fleet_util_exceeded","state":"breached","util":0.95,"window_hours":24,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });

  it("accepts fleet_util_recovered payload", () => {
    const body = '{"event":"fleet_util_recovered","state":"ok","util":0.3,"window_hours":24,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });
});

describe("validate — negative monitor_id rejection (codex fix)", () => {
  it("rejects account_suspended with monitor_id=-1 with 400", () => {
    const body = '{"event":"account_suspended","account_id":42,"monitor_id":-1,"reason":"fraud","detail":"d","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects cap_hit with monitor_id=-1 with 400", () => {
    const body = '{"event":"cap_hit","account_id":42,"monitor_id":-1,"monitors_current":100,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("accepts account_suspended with monitor_id=0 (allowZero=true)", () => {
    const body = '{"event":"account_suspended","account_id":42,"monitor_id":0,"reason":"fraud","detail":"d","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });

  it("rejects account_suspension_failed with monitor_id=-1 with 400", () => {
    const body = '{"event":"account_suspension_failed","account_id":42,"monitor_id":-1,"reason":"dns_rebinding","detail":"d","error":"db timeout","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("accepts account_suspension_failed with monitor_id=0 (allowZero=true)", () => {
    const body = '{"event":"account_suspension_failed","account_id":42,"monitor_id":0,"reason":"dns_rebinding","detail":"d","error":"db timeout","detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });
});

describe("validate — fleet state mismatch (codex fix)", () => {
  it("rejects fleet_util_exceeded with missing state with 400", () => {
    const body = '{"event":"fleet_util_exceeded","util":0.95,"window_hours":24,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/state=breached/);
    }
  });

  it("rejects fleet_util_exceeded with state=ok with 400", () => {
    const body = '{"event":"fleet_util_exceeded","state":"ok","util":0.95,"window_hours":24,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/state=breached/);
    }
  });

  it("rejects fleet_util_recovered with missing state with 400", () => {
    const body = '{"event":"fleet_util_recovered","util":0.3,"window_hours":24,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/state=ok/);
    }
  });

  it("rejects fleet_util_recovered with state=breached with 400", () => {
    const body = '{"event":"fleet_util_recovered","state":"breached","util":0.3,"window_hours":24,"detected_at":"2026-01-01T00:00:00Z"}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/state=ok/);
    }
  });
});

describe("validate — RFC3339 strict date validation (codex fix)", () => {
  it("rejects 2026-02-29T00:00:00Z (non-leap year) with 400", () => {
    const body = `{"event":"monitor.down","monitor_id":1,"occurred_at":"2026-02-29T00:00:00Z"}`;
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects 2025-02-29T00:00:00Z (non-leap year) with 400", () => {
    const body = `{"event":"monitor.down","monitor_id":1,"occurred_at":"2025-02-29T00:00:00Z"}`;
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects T24:00:00Z (hour overflow) with 400", () => {
    const body = `{"event":"monitor.down","monitor_id":1,"occurred_at":"2026-01-01T24:00:00Z"}`;
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects T23:60:00Z (minute overflow) with 400", () => {
    const body = `{"event":"monitor.down","monitor_id":1,"occurred_at":"2026-01-01T23:60:00Z"}`;
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects +99:99 offset with 400", () => {
    const body = `{"event":"monitor.down","monitor_id":1,"occurred_at":"2026-01-01T00:00:00+99:99"}`;
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("accepts 2024-02-29T00:00:00Z (leap year) with 200", () => {
    const body = `{"event":"monitor.down","monitor_id":1,"occurred_at":"2024-02-29T00:00:00Z"}`;
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
  });
});

describe("validate — null optionals degrade (not 400)", () => {
  // An upstream that serializes empty optionals as JSON null must not be
  // rejected — null is treated as absent so the provider's fallback applies.
  it("accepts monitor.down with null optional fields", () => {
    const body = '{"event":"monitor.down","monitor_id":1,"occurred_at":"2026-01-01T00:00:00Z","monitor_name":null,"monitor_url":null,"reason":null,"account_id":null,"delivery_id":null,"attempt":null}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(true);
    if (r.ok) {
      // null optionals are dropped, not carried through as null.
      expect("monitor_name" in r.payload).toBe(false);
      expect("monitor_url" in r.payload).toBe(false);
    }
  });
});
