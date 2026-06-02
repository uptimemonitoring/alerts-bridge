import type { Env, Provider, WebhookPayload } from "../types.js";

const PUSHOVER_API = "https://api.pushover.net/1/messages.json";
const TITLE_MAX = 250;
const MESSAGE_MAX = 1024;

function truncate(s: string, max: number): string {
  const cp = Array.from(s);
  if (cp.length <= max) return s;
  return cp.slice(0, max - 1).join("") + "…";
}

function getPriority(payload: WebhookPayload): number {
  switch (payload.event) {
    case "monitor.down": return 2;
    case "monitor.up": return 0;
    case "monitor.flapping": return 1;
    case "kill_switch_flipped": return payload.active ? 2 : 0;
    case "account_suspended": return 2;
    case "cap_hit": return 1;
    case "fleet_util_exceeded": return 1;
    case "fleet_util_recovered": return 0;
    default: {
      const exhausted: never = payload;
      throw new Error(`unhandled event: ${(exhausted as { event: string }).event}`);
    }
  }
}

function format(payload: WebhookPayload): { title: string; message: string } {
  switch (payload.event) {
    case "monitor.down": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let message = `${name} is DOWN`;
      if (payload.reason) message += ` — ${payload.reason}`;
      if (payload.monitor_url) message += `\n${payload.monitor_url}`;
      message += `\nDetected: ${payload.occurred_at}`;
      return { title: `[DOWN] ${name}`, message };
    }
    case "monitor.up": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let message = `${name} is UP`;
      if (payload.reason) message += ` — ${payload.reason}`;
      if (payload.monitor_url) message += `\n${payload.monitor_url}`;
      message += `\nDetected: ${payload.occurred_at}`;
      return { title: `[UP] ${name}`, message };
    }
    case "monitor.flapping": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let message = `${name} is FLAPPING`;
      if (payload.reason) message += ` — ${payload.reason}`;
      if (payload.monitor_url) message += `\n${payload.monitor_url}`;
      message += `\nDetected: ${payload.occurred_at}`;
      return { title: `[FLAPPING] ${name}`, message };
    }
    case "kill_switch_flipped": {
      const state = payload.active ? "ACTIVATED" : "DEACTIVATED";
      const titleWord = payload.active ? "Activated" : "Deactivated";
      const actor = payload.actor ? ` | Actor: ${payload.actor}` : "";
      return {
        title: `Kill Switch ${titleWord}`,
        message: `Kill switch ${state}\nPath: ${payload.sentinel_path} | Detected: ${payload.detected_at}${actor}`,
      };
    }
    case "account_suspended": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Account Suspended",
        message: `Account #${payload.account_id} suspended${monitorSeg}.\nReason: ${payload.reason} | Detail: ${payload.detail} | Detected: ${payload.detected_at}`,
      };
    }
    case "cap_hit": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Monitor Cap Hit",
        message: `Monitor cap hit. Account #${payload.account_id} has ${payload.monitors_current} monitors${monitorSeg}.\nDetected: ${payload.detected_at}`,
      };
    }
    case "fleet_util_exceeded":
      return {
        title: "Fleet Utilization Exceeded",
        message: `Fleet utilization EXCEEDED: ${(payload.util * 100).toFixed(1)}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
      };
    case "fleet_util_recovered":
      return {
        title: "Fleet Utilization Recovered",
        message: `Fleet utilization recovered: ${(payload.util * 100).toFixed(1)}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
      };
    default: {
      const exhausted: never = payload;
      throw new Error(`unhandled event: ${(exhausted as { event: string }).event}`);
    }
  }
}

function getCredentials(env: Env): { token: string; user: string } {
  return {
    token: env.PUSHOVER_TOKEN?.trim() ?? "",
    user: env.PUSHOVER_USER?.trim() ?? "",
  };
}

export const pushover: Provider = {
  name: "pushover",

  validateEnv(env: Env): void {
    const { token, user } = getCredentials(env);
    if (!token || !user) {
      throw new Error(
        "alerts-bridge: PUSHOVER_TOKEN and PUSHOVER_USER required when PROVIDER includes pushover",
      );
    }
  },

  async send(payload: WebhookPayload, env: Env): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { token, user } = getCredentials(env);
    const priority = getPriority(payload);
    const { title, message } = format(payload);

    const params = new URLSearchParams({
      token,
      user,
      title: truncate(title, TITLE_MAX),
      message: truncate(message, MESSAGE_MAX),
      priority: String(priority),
    });

    if (priority === 2) {
      params.set("retry", "30");
      params.set("expire", "1800");
    }

    const res = await fetch(PUSHOVER_API, {
      method: "POST",
      body: params,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, reason: `pushover ${res.status}: ${await res.text()}` };
  },
};
