import type { Env, Provider, WebhookPayload } from "../types.js";

const NTFY_DEFAULT_URL = "https://ntfy.sh";
const TITLE_MAX = 250;

function truncate(s: string, max: number): string {
  const cp = Array.from(s);
  if (cp.length <= max) return s;
  return cp.slice(0, max - 1).join("") + "…";
}

function getPriority(payload: WebhookPayload): number {
  switch (payload.event) {
    case "down": return 5;
    case "up": return 3;
    case "kill_switch_flipped": return payload.active ? 5 : 3;
    case "account_suspended": return 5;
    case "cap_hit": return 4;
    case "fleet_util_exceeded": return 4;
    case "fleet_util_recovered": return 3;
    default: {
      const exhausted: never = payload;
      throw new Error(`unhandled event: ${(exhausted as { event: string }).event}`);
    }
  }
}

function getTags(payload: WebhookPayload): string[] {
  switch (payload.event) {
    case "down": return ["rotating_light"];
    case "up": return ["white_check_mark"];
    case "kill_switch_flipped": return payload.active ? ["lock"] : ["unlock"];
    case "account_suspended": return ["no_entry"];
    case "cap_hit": return ["chart_with_upwards_trend"];
    case "fleet_util_exceeded": return ["warning"];
    case "fleet_util_recovered": return ["white_check_mark"];
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

export const ntfy: Provider = {
  name: "ntfy",

  validateEnv(env: Env): void {
    if (!env.NTFY_TOPIC) {
      throw new Error(
        "alerts-bridge: NTFY_TOPIC required when PROVIDER includes ntfy",
      );
    }
  },

  async send(payload: WebhookPayload, env: Env): Promise<{ ok: true } | { ok: false; reason: string }> {
    const base = (env.NTFY_URL || NTFY_DEFAULT_URL).replace(/\/+$/, "");
    const url = `${base}/${env.NTFY_TOPIC}`;
    const { title, message } = format(payload);

    const headers: Record<string, string> = {
      "Title": truncate(title, TITLE_MAX),
      "Priority": String(getPriority(payload)),
      "Tags": getTags(payload).join(","),
    };

    if (env.NTFY_TOKEN) {
      headers["Authorization"] = `Bearer ${env.NTFY_TOKEN}`;
    }

    const res = await fetch(url, {
      method: "POST",
      body: message,
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, reason: `ntfy ${res.status}: ${await res.text()}` };
  },
};
