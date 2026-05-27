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

const MONITOR_DOWN = '{"event":"down","monitor":{"id":1287,"name":"myapp-healthz"},"detected_at":"2026-04-12T14:23:11Z","evidence":{"primary_error":"http_5xx","status_code":503,"region":"US-E"}}';
const MONITOR_UP   = '{"event":"up","monitor":{"id":1287,"name":"myapp-healthz"},"detected_at":"2026-04-12T14:31:02Z","evidence":{"primary_error":"","status_code":200,"region":"US-E"}}';
const KILL_SWITCH  = '{"event":"kill_switch_flipped","active":true,"sentinel_path":"/var/lib/monitive/kill","detected_at":"2026-04-12T14:23:11Z","actor":"lucianmd"}';

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
    // Build a valid monitor payload padded to exactly 65536 bytes via a long name
    const base = '{"event":"down","monitor":{"id":1,"name":"';
    const suffix = '"},"detected_at":"2026-01-01T00:00:00Z","evidence":{"primary_error":"e","status_code":503,"region":"US"}}';
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
  it("rejects missing monitor.name with 400", () => {
    const body = '{"event":"down","monitor":{"id":1},"detected_at":"2026-01-01T00:00:00Z","evidence":{"primary_error":"e","status_code":503,"region":"US"}}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects non-RFC3339 detected_at with 400", () => {
    const body = '{"event":"down","monitor":{"id":1,"name":"x"},"detected_at":"yesterday","evidence":{"primary_error":"e","status_code":503,"region":"US"}}';
    const r = validate(makeReq("POST", body), utf8(body));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/RFC3339/);
    }
  });

  it("rejects fractional monitor.id (P2 migration regression)", () => {
    const body = '{"event":"down","monitor":{"id":1.5,"name":"x"},"detected_at":"2026-01-01T00:00:00Z","evidence":{"primary_error":"e","status_code":503,"region":"US"}}';
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
