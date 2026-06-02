import type { Env, Provider, WebhookPayload } from "../types.js";

const TITLE_MAX = 256;
const DESC_MAX = 4096;

function truncate(s: string, max: number): string {
  const cp = Array.from(s);
  if (cp.length <= max) return s;
  return cp.slice(0, max - 1).join("") + "…";
}

function getColor(payload: WebhookPayload): number {
  switch (payload.event) {
    case "down": return 0xE01E5A;
    case "up": return 0x2EB67D;
    case "kill_switch_flipped": return payload.active ? 0xE01E5A : 0x2EB67D;
    case "account_suspended": return 0xE01E5A;
    case "cap_hit": return 0xF2C744;
    case "fleet_util_exceeded": return 0xF2C744;
    case "fleet_util_recovered": return 0x2EB67D;
    default: {
      const exhausted: never = payload;
      throw new Error(`unhandled event: ${(exhausted as { event: string }).event}`);
    }
  }
}

function format(payload: WebhookPayload): { title: string; description: string } {
  switch (payload.event) {
    case "down":
      return {
        title: `[DOWN] ${payload.monitor.name}`,
        description: `Monitor #${payload.monitor.id} (${payload.monitor.name}) is DOWN.\nError: ${payload.evidence.primary_error} | Status: ${payload.evidence.status_code} | Region: ${payload.evidence.region} | Detected: ${payload.detected_at}`,
      };
    case "up":
      return {
        title: `[UP] ${payload.monitor.name}`,
        description: `Monitor #${payload.monitor.id} (${payload.monitor.name}) is UP.\nStatus: ${payload.evidence.status_code} | Region: ${payload.evidence.region} | Detected: ${payload.detected_at}`,
      };
    case "kill_switch_flipped": {
      const state = payload.active ? "ACTIVATED" : "DEACTIVATED";
      const titleWord = payload.active ? "Activated" : "Deactivated";
      const actor = payload.actor ? ` | Actor: ${payload.actor}` : "";
      return {
        title: `Kill Switch ${titleWord}`,
        description: `Kill switch ${state}\nPath: ${payload.sentinel_path} | Detected: ${payload.detected_at}${actor}`,
      };
    }
    case "account_suspended": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Account Suspended",
        description: `Account #${payload.account_id} suspended${monitorSeg}.\nReason: ${payload.reason} | Detail: ${payload.detail} | Detected: ${payload.detected_at}`,
      };
    }
    case "cap_hit": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Monitor Cap Hit",
        description: `Monitor cap hit. Account #${payload.account_id} has ${payload.monitors_current} monitors${monitorSeg}.\nDetected: ${payload.detected_at}`,
      };
    }
    case "fleet_util_exceeded":
      return {
        title: "Fleet Utilization Exceeded",
        description: `Fleet utilization EXCEEDED: ${(payload.util * 100).toFixed(1)}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
      };
    case "fleet_util_recovered":
      return {
        title: "Fleet Utilization Recovered",
        description: `Fleet utilization recovered: ${(payload.util * 100).toFixed(1)}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
      };
    default: {
      const exhausted: never = payload;
      throw new Error(`unhandled event: ${(exhausted as { event: string }).event}`);
    }
  }
}

export const discord: Provider = {
  name: "discord",

  validateEnv(env: Env): void {
    if (!env.DISCORD_WEBHOOK_URL?.trim()) {
      throw new Error(
        "alerts-bridge: DISCORD_WEBHOOK_URL required when PROVIDER includes discord",
      );
    }
  },

  async send(payload: WebhookPayload, env: Env): Promise<{ ok: true } | { ok: false; reason: string }> {
    const url = env.DISCORD_WEBHOOK_URL!.trim();
    const color = getColor(payload);
    const { title, description } = format(payload);

    const body = JSON.stringify({
      embeds: [
        {
          title: truncate(title, TITLE_MAX),
          description: truncate(description, DESC_MAX),
          color,
        },
      ],
    });

    const res = await fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, reason: `discord ${res.status}: ${await res.text()}` };
  },
};
