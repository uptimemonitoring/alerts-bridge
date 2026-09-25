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
    case "monitor.down": return 0xE01E5A;
    case "monitor.up": return 0x2EB67D;
    case "monitor.flapping": return 0xF2C744;
    case "kill_switch_flipped": return payload.active ? 0xE01E5A : 0x2EB67D;
    case "account_suspended": return 0xE01E5A;
    case "account_suspension_failed": return 0xE01E5A;
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
    case "monitor.down": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let description = `${name} is DOWN`;
      if (payload.reason) description += ` — ${payload.reason}`;
      if (payload.monitor_url) description += `\n${payload.monitor_url}`;
      description += `\nDetected: ${payload.occurred_at}`;
      return { title: `[DOWN] ${name}`, description };
    }
    case "monitor.up": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let description = `${name} is UP`;
      if (payload.reason) description += ` — ${payload.reason}`;
      if (payload.monitor_url) description += `\n${payload.monitor_url}`;
      description += `\nDetected: ${payload.occurred_at}`;
      return { title: `[UP] ${name}`, description };
    }
    case "monitor.flapping": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let description = `${name} is FLAPPING`;
      if (payload.reason) description += ` — ${payload.reason}`;
      if (payload.monitor_url) description += `\n${payload.monitor_url}`;
      description += `\nDetected: ${payload.occurred_at}`;
      return { title: `[FLAPPING] ${name}`, description };
    }
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
    case "account_suspension_failed": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Account Suspension Failed",
        description: `Account #${payload.account_id} suspension FAILED${monitorSeg}. Account remains ACTIVE.\nReason: ${payload.reason} | Detail: ${payload.detail} | Error: ${payload.error} | Detected: ${payload.detected_at}`,
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
