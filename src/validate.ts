import type { WebhookPayload } from "./types.js";
import { isMonitorEvent, isSecurityEvent } from "./types.js";

export type ValidationResult =
  | { ok: true; payload: WebhookPayload }
  | { ok: false; status: 400 | 405 | 413 | 415; message: string };

const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validTimestamp(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (!RFC3339_RE.test(s)) return false;

  // Parse components from fixed character positions (regex guarantees digit layout)
  const year   = parseInt(s.slice(0, 4), 10);
  const month  = parseInt(s.slice(5, 7), 10);
  const day    = parseInt(s.slice(8, 10), 10);
  const hour   = parseInt(s.slice(11, 13), 10);
  const minute = parseInt(s.slice(14, 16), 10);
  const second = parseInt(s.slice(17, 19), 10);

  // Reject out-of-range time components (catches T24:00:00Z, T23:60:00Z, etc.)
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;

  // Reject out-of-range UTC offset (catches +99:99)
  if (s[s.length - 1] !== "Z") {
    const offH = parseInt(s.slice(-5, -3), 10);
    const offM = parseInt(s.slice(-2), 10);
    if (offH > 23 || offM > 59) return false;
  }

  // Round-trip: if any component overflows (e.g. Feb 29 in a non-leap year
  // normalizes to Mar 1), Date.UTC reflects that and the comparison fails
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day &&
    d.getUTCHours() === hour &&
    d.getUTCMinutes() === minute &&
    d.getUTCSeconds() === second
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function requireSafeInt(obj: Record<string, unknown>, key: string, allowZero = false): number | null {
  const v = obj[key];
  if (!Number.isSafeInteger(v)) return null;
  if (!allowZero && (v as number) <= 0) return null;
  return v as number;
}

function requireFiniteNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && isFinite(v) ? v : null;
}

function requireBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

function validateMonitorPayload(
  event: "down" | "up",
  body: Record<string, unknown>,
): ValidationResult {
  const monitorRaw = body["monitor"];
  if (!isObject(monitorRaw)) {
    return { ok: false, status: 400, message: "missing or invalid monitor object" };
  }
  const id = requireSafeInt(monitorRaw, "id");
  if (id === null) return { ok: false, status: 400, message: "monitor.id must be a positive integer" };
  const name = requireString(monitorRaw, "name");
  if (name === null) return { ok: false, status: 400, message: "monitor.name must be a string" };

  if (!validTimestamp(body["detected_at"])) {
    return { ok: false, status: 400, message: "detected_at must be an RFC3339 timestamp" };
  }

  const evidenceRaw = body["evidence"];
  if (!isObject(evidenceRaw)) {
    return { ok: false, status: 400, message: "missing or invalid evidence object" };
  }
  if (requireString(evidenceRaw, "primary_error") === null) {
    return { ok: false, status: 400, message: "evidence.primary_error must be a string" };
  }
  const statusCode = evidenceRaw["status_code"];
  if (!Number.isSafeInteger(statusCode) || (statusCode as number) < 0) {
    return { ok: false, status: 400, message: "evidence.status_code must be a non-negative integer" };
  }
  if (requireString(evidenceRaw, "region") === null) {
    return { ok: false, status: 400, message: "evidence.region must be a string" };
  }

  return {
    ok: true,
    payload: {
      event,
      monitor: { id, name },
      detected_at: body["detected_at"] as string,
      evidence: {
        primary_error: evidenceRaw["primary_error"] as string,
        status_code: statusCode as number,
        region: evidenceRaw["region"] as string,
      },
    },
  };
}

function validateSecurityPayload(
  event: string,
  body: Record<string, unknown>,
): ValidationResult {
  switch (event) {
    case "kill_switch_flipped": {
      const active = requireBoolean(body, "active");
      if (active === null) return { ok: false, status: 400, message: "active must be a boolean" };
      const sentinel_path = requireString(body, "sentinel_path");
      if (sentinel_path === null) return { ok: false, status: 400, message: "sentinel_path must be a string" };
      if (!validTimestamp(body["detected_at"])) {
        return { ok: false, status: 400, message: "detected_at must be an RFC3339 timestamp" };
      }
      const actorRaw = body["actor"];
      const actor = actorRaw === undefined ? undefined : typeof actorRaw === "string" ? actorRaw : null;
      if (actor === null) return { ok: false, status: 400, message: "actor must be a string if present" };
      return {
        ok: true,
        payload: {
          event: "kill_switch_flipped",
          active,
          sentinel_path,
          detected_at: body["detected_at"] as string,
          ...(actor !== undefined ? { actor } : {}),
        },
      };
    }
    case "account_suspended": {
      const account_id = requireSafeInt(body, "account_id");
      if (account_id === null) return { ok: false, status: 400, message: "account_id must be a positive integer" };
      // monitor_id may be 0 when not applicable
      const monitor_id = requireSafeInt(body, "monitor_id", true);
      if (monitor_id === null) return { ok: false, status: 400, message: "monitor_id must be a non-negative integer" };
      const reason = requireString(body, "reason");
      if (reason === null) return { ok: false, status: 400, message: "reason must be a string" };
      const detail = requireString(body, "detail");
      if (detail === null) return { ok: false, status: 400, message: "detail must be a string" };
      if (!validTimestamp(body["detected_at"])) {
        return { ok: false, status: 400, message: "detected_at must be an RFC3339 timestamp" };
      }
      return {
        ok: true,
        payload: {
          event: "account_suspended",
          account_id,
          monitor_id,
          reason,
          detail,
          detected_at: body["detected_at"] as string,
        },
      };
    }
    case "cap_hit": {
      const account_id = requireSafeInt(body, "account_id");
      if (account_id === null) return { ok: false, status: 400, message: "account_id must be a positive integer" };
      const monitor_id = requireSafeInt(body, "monitor_id", true);
      if (monitor_id === null) return { ok: false, status: 400, message: "monitor_id must be a non-negative integer" };
      const monitors_current = requireSafeInt(body, "monitors_current");
      if (monitors_current === null) return { ok: false, status: 400, message: "monitors_current must be a positive integer" };
      if (!validTimestamp(body["detected_at"])) {
        return { ok: false, status: 400, message: "detected_at must be an RFC3339 timestamp" };
      }
      return {
        ok: true,
        payload: {
          event: "cap_hit",
          account_id,
          monitor_id,
          monitors_current,
          detected_at: body["detected_at"] as string,
        },
      };
    }
    case "fleet_util_exceeded": {
      if (body["state"] !== "breached") {
        return { ok: false, status: 400, message: "fleet_util_exceeded requires state=breached" };
      }
      const util = requireFiniteNumber(body, "util");
      if (util === null) return { ok: false, status: 400, message: "util must be a finite number" };
      const window_hours = requireSafeInt(body, "window_hours");
      if (window_hours === null) return { ok: false, status: 400, message: "window_hours must be a positive integer" };
      if (!validTimestamp(body["detected_at"])) {
        return { ok: false, status: 400, message: "detected_at must be an RFC3339 timestamp" };
      }
      return {
        ok: true,
        payload: {
          event: "fleet_util_exceeded",
          state: "breached",
          util,
          window_hours,
          detected_at: body["detected_at"] as string,
        },
      };
    }
    case "fleet_util_recovered": {
      if (body["state"] !== "ok") {
        return { ok: false, status: 400, message: "fleet_util_recovered requires state=ok" };
      }
      const util = requireFiniteNumber(body, "util");
      if (util === null) return { ok: false, status: 400, message: "util must be a finite number" };
      const window_hours = requireSafeInt(body, "window_hours");
      if (window_hours === null) return { ok: false, status: 400, message: "window_hours must be a positive integer" };
      if (!validTimestamp(body["detected_at"])) {
        return { ok: false, status: 400, message: "detected_at must be an RFC3339 timestamp" };
      }
      return {
        ok: true,
        payload: {
          event: "fleet_util_recovered",
          state: "ok",
          util,
          window_hours,
          detected_at: body["detected_at"] as string,
        },
      };
    }
    default:
      return { ok: false, status: 400, message: "unknown event" };
  }
}

export function validate(req: Request, raw: Uint8Array): ValidationResult {
  if (req.method !== "POST") {
    return { ok: false, status: 405, message: "method not allowed" };
  }

  const ct = req.headers.get("content-type");
  const mediaType = ct?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, status: 415, message: "unsupported media type" };
  }

  // Check Content-Length header first for an early reject before reading raw bytes.
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const len = parseInt(contentLength, 10);
    if (Number.isFinite(len) && len > 65536) {
      return { ok: false, status: 413, message: "request body too large" };
    }
  }

  if (raw.byteLength > 65536) {
    return { ok: false, status: 413, message: "request body too large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { ok: false, status: 400, message: "malformed JSON" };
  }

  if (!isObject(parsed)) {
    return { ok: false, status: 400, message: "missing event discriminator" };
  }

  const event = parsed["event"];
  if (typeof event !== "string") {
    return { ok: false, status: 400, message: "missing event discriminator" };
  }

  if (isMonitorEvent(event)) {
    return validateMonitorPayload(event, parsed);
  }

  if (isSecurityEvent(event)) {
    return validateSecurityPayload(event, parsed);
  }

  return { ok: false, status: 400, message: "unknown event" };
}
