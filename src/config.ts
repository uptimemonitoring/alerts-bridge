import type { Env } from "./types.js";
import { lookupProvider } from "./providers/index.js";

export interface Config {
  monitorSecrets: string[];
  securityAlertSecrets: string[];
  providers: string[];
}

const SECRET_CAP = 50;
const PROVIDER_CAP = 10;

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

function parseProviders(raw: string | undefined): string[] {
  if (!raw) return [];
  const names = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  // Order-preserving deduplication
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      deduped.push(name);
    }
  }
  if (deduped.length > PROVIDER_CAP) {
    console.warn(
      `alerts-bridge: provider list truncated to ${PROVIDER_CAP} entries (got ${deduped.length})`,
    );
    return deduped.slice(0, PROVIDER_CAP);
  }
  return deduped;
}

export function loadConfig(env: Env): Config {
  const monitorSecrets = parseSecrets(env.MONITOR_WEBHOOK_SECRETS);
  const securityAlertSecrets = parseSecrets(env.SECURITY_ALERT_WEBHOOK_SECRETS);
  const providers = parseProviders(env.PROVIDER);
  for (const name of providers) {
    lookupProvider(name)?.validateEnv?.(env);
  }
  return { monitorSecrets, securityAlertSecrets, providers };
}
