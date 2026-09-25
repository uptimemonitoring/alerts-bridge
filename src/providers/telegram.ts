import type { Env, Provider, WebhookPayload } from "../types.js";

const TEXT_MAX = 4096;

function truncate(s: string, max: number): string {
  const cp = Array.from(s);
  if (cp.length <= max) return s;
  return cp.slice(0, max - 1).join("") + "…";
}

function format(payload: WebhookPayload): { title: string; body: string } {
  switch (payload.event) {
    case "monitor.down": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let body = `${name} is DOWN`;
      if (payload.reason) body += ` — ${payload.reason}`;
      if (payload.monitor_url) body += `\n${payload.monitor_url}`;
      body += `\nDetected: ${payload.occurred_at}`;
      return { title: `[DOWN] ${name}`, body };
    }
    case "monitor.up": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let body = `${name} is UP`;
      if (payload.reason) body += ` — ${payload.reason}`;
      if (payload.monitor_url) body += `\n${payload.monitor_url}`;
      body += `\nDetected: ${payload.occurred_at}`;
      return { title: `[UP] ${name}`, body };
    }
    case "monitor.flapping": {
      const name = payload.monitor_name ?? `Monitor #${payload.monitor_id}`;
      let body = `${name} is FLAPPING`;
      if (payload.reason) body += ` — ${payload.reason}`;
      if (payload.monitor_url) body += `\n${payload.monitor_url}`;
      body += `\nDetected: ${payload.occurred_at}`;
      return { title: `[FLAPPING] ${name}`, body };
    }
    case "kill_switch_flipped": {
      const state = payload.active ? "ACTIVATED" : "DEACTIVATED";
      const titleWord = payload.active ? "Activated" : "Deactivated";
      const actor = payload.actor ? ` | Actor: ${payload.actor}` : "";
      return {
        title: `Kill Switch ${titleWord}`,
        body: `Kill switch ${state}\nPath: ${payload.sentinel_path} | Detected: ${payload.detected_at}${actor}`,
      };
    }
    case "account_suspended": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Account Suspended",
        body: `Account #${payload.account_id} suspended${monitorSeg}.\nReason: ${payload.reason} | Detail: ${payload.detail} | Detected: ${payload.detected_at}`,
      };
    }
    case "account_suspension_failed": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Account Suspension Failed",
        body: `Account #${payload.account_id} suspension FAILED${monitorSeg}. Account remains ACTIVE.\nReason: ${payload.reason} | Detail: ${payload.detail} | Error: ${payload.error} | Detected: ${payload.detected_at}`,
      };
    }
    case "cap_hit": {
      const monitorSeg = payload.monitor_id !== 0 ? ` (monitor #${payload.monitor_id})` : "";
      return {
        title: "Monitor Cap Hit",
        body: `Monitor cap hit. Account #${payload.account_id} has ${payload.monitors_current} monitors${monitorSeg}.\nDetected: ${payload.detected_at}`,
      };
    }
    case "fleet_util_exceeded":
      return {
        title: "Fleet Utilization Exceeded",
        body: `Fleet utilization EXCEEDED: ${(payload.util * 100).toFixed(1)}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
      };
    case "fleet_util_recovered":
      return {
        title: "Fleet Utilization Recovered",
        body: `Fleet utilization recovered: ${(payload.util * 100).toFixed(1)}% over ${payload.window_hours}h window.\nDetected: ${payload.detected_at}`,
      };
    default: {
      const exhausted: never = payload;
      throw new Error(`unhandled event: ${(exhausted as { event: string }).event}`);
    }
  }
}

export const telegram: Provider = {
  name: "telegram",

  validateEnv(env: Env): void {
    if (!env.TELEGRAM_BOT_TOKEN?.trim() || !env.TELEGRAM_CHAT_ID?.trim()) {
      throw new Error(
        "alerts-bridge: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required when PROVIDER includes telegram",
      );
    }
  },

  async send(payload: WebhookPayload, env: Env): Promise<{ ok: true } | { ok: false; reason: string }> {
    const token = env.TELEGRAM_BOT_TOKEN!.trim();
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const { title, body } = format(payload);
    const text = `${title}\n${body}`;

    const requestBody = JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID!.trim(),
      text: truncate(text, TEXT_MAX),
    });

    const res = await fetch(url, {
      method: "POST",
      body: requestBody,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, reason: `telegram ${res.status}: ${await res.text()}` };
  },
};
