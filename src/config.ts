import type { Env } from "./types.js";

export interface Config {
  monitorSecrets: string[];
  securityAlertSecrets: string[];
  providers: string[];
}

const SECRET_CAP = 50;

function parseSecrets(raw: string | undefined): string[] {
  if (!raw) return [];
  const list = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (list.length > SECRET_CAP) {
    console.warn(
      `alerts-bridge: secret list truncated to ${SECRET_CAP} entries (got ${list.length})`,
    );
    return list.slice(0, SECRET_CAP);
  }
  return list;
}

export function loadConfig(env: Env): Config {
  const monitorSecrets = parseSecrets(env.MONITOR_WEBHOOK_SECRETS);
  const securityAlertSecrets = parseSecrets(env.SECURITY_ALERT_WEBHOOK_SECRETS);
  const providers = env.PROVIDER
    ? env.PROVIDER.split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
    : [];
  return { monitorSecrets, securityAlertSecrets, providers };
}
