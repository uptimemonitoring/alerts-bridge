export type MonitorEvent = "monitor.down" | "monitor.up" | "monitor.flapping";

export type SecurityEvent =
  | "kill_switch_flipped"
  | "account_suspended"
  | "cap_hit"
  | "fleet_util_exceeded"
  | "fleet_util_recovered";

export interface MonitorWebhookPayload {
  event: MonitorEvent;
  monitor_id: number;
  occurred_at: string;
  monitor_name?: string;
  monitor_url?: string;
  reason?: string;
  account_id?: number;
  delivery_id?: number;
  attempt?: number;
}

// Pinned to alerter.go:32-37, 176-184
interface KillSwitchFlippedPayload {
  event: "kill_switch_flipped";
  active: boolean;
  sentinel_path: string;
  detected_at: string;
  actor?: string;
}

// Pinned to alerter.go:18-25, 126-133
interface AccountSuspendedPayload {
  event: "account_suspended";
  account_id: number;
  monitor_id: number;
  reason: string;
  detail: string;
  detected_at: string;
}

// Pinned to alerter.go:43-48, 221-227
interface CapHitPayload {
  event: "cap_hit";
  account_id: number;
  monitor_id: number;
  monitors_current: number;
  detected_at: string;
}

// Pinned to alerter.go:55-60, 263-269
interface FleetUtilExceededPayload {
  event: "fleet_util_exceeded";
  state: "breached";
  util: number;
  window_hours: number;
  detected_at: string;
}

// Pinned to alerter.go:296-310
interface FleetUtilRecoveredPayload {
  event: "fleet_util_recovered";
  state: "ok";
  util: number;
  window_hours: number;
  detected_at: string;
}

export type SecurityAlertPayload =
  | KillSwitchFlippedPayload
  | AccountSuspendedPayload
  | CapHitPayload
  | FleetUtilExceededPayload
  | FleetUtilRecoveredPayload;

export type WebhookPayload = MonitorWebhookPayload | SecurityAlertPayload;

export function isMonitorEvent(s: string): s is MonitorEvent {
  return s === "monitor.down" || s === "monitor.up" || s === "monitor.flapping";
}

export function isSecurityEvent(s: string): s is SecurityEvent {
  return (
    s === "kill_switch_flipped" ||
    s === "account_suspended" ||
    s === "cap_hit" ||
    s === "fleet_util_exceeded" ||
    s === "fleet_util_recovered"
  );
}

export interface Env {
  MONITOR_WEBHOOK_SECRETS?: string;
  SECURITY_ALERT_WEBHOOK_SECRETS?: string;
  PROVIDER?: string;
  PUSHOVER_TOKEN?: string;
  PUSHOVER_USER?: string;
  // Pushover priority for monitor.down alerts. One of -2,-1,0,1,2.
  // Defaults to 2 (emergency: retry+expire, bypasses quiet hours) when unset
  // or invalid. Set to 0 for a normal, non-waking notification.
  PUSHOVER_DOWN_PRIORITY?: string;
  NTFY_URL?: string;
  NTFY_TOPIC?: string;
  NTFY_TOKEN?: string;
  SLACK_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/** Implemented by every notification backend. Resolve; never throw. */
export interface Provider {
  readonly name: string;
  send(payload: WebhookPayload, env: Env): Promise<{ ok: true } | { ok: false; reason: string }>;
  validateEnv?(env: Env): void;
}
