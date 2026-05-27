import type { Env, Provider, WebhookPayload } from "../types.js";

const PUSHOVER_API = "https://api.pushover.net/1/messages.json";
const TITLE_MAX = 250;
const MESSAGE_MAX = 1024;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function getPriority(payload: WebhookPayload): number {
  switch (payload.event) {
    case "down": return 2;
    case "up": return 0;
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
    case "down":
      return {
        title: `[DOWN] ${payload.monitor.name}`,
        message: `Monitor #${payload.monitor.id} (${payload.monitor.name}) is DOWN.\nError: ${payload.evidence.primary_error} | Status: ${payload.evidence.status_code} | Region: ${payload.evidence.region} | Detected: ${payload.detected_at}`,
      };
    case "up":
      return {
        title: `[UP] ${payload.monitor.name}`,
        message: `Monitor #${payload.monitor.id} (${payload.monitor.name}) is UP.\nStatus: ${payload.evidence.status_code} | Region: ${payload.evidence.region} | Detected: ${payload.detected_at}`,
      };
    case "kill_switch_flipped": {
      const state = payload.active ? "ACTIVATED" : "DEACTIVATED";
      const titleWord = payload.active ? "Activated" : "Deactivated";
      const actor = payload.actor ? ` | Actor: ${payload.actor}` : "";
      return {
        title: `Kill Switch ${titleWord}`,
        message: `Kill switch ${state}\nPath: ${payload.sentinel_path} | Detected: ${payload.detected_at}${actor}`,
      };
    }
    case "account_suspended":
      return {
        title: "Account Suspended",
        message: `Account #${payload.account_id} suspended (monitor #${payload.monitor_id}).\nReason: ${payload.reason} | Detail: ${payload.detail} | Detected: ${payload.detected_at}`,
      };
    case "cap_hit":
      return {
        title: "Monitor Cap Hit",
        message: `Monitor cap hit. Account #${payload.account_id} has ${payload.monitors_current} monitors (monitor #${payload.monitor_id}).\nDetected: ${payload.detected_at}`,
      };
    case "fleet_util_exceeded":
      return {
        title: "Fleet Utilization Exceeded",
        message: `Fleet utilization EXCEEDED: ${payload.util}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
      };
    case "fleet_util_recovered":
      return {
        title: "Fleet Utilization Recovered",
        message: `Fleet utilization recovered: ${payload.util}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
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

  async send(payload: WebhookPayload, env: Env): Promise<{ provider: string; status: number }> {
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
      return { provider: "pushover", status: res.status };
    }
    throw new Error(`pushover ${res.status}: ${await res.text()}`);
  },
};
