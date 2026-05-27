import { verifySignature } from "./auth.js";
import { loadConfig, loadSecrets } from "./config.js";
import { lookupProvider } from "./providers/index.js";
import { isMonitorEvent } from "./types.js";
import { validate } from "./validate.js";

export async function handle(req: Request, env: import("./types.js").Env, raw: Uint8Array): Promise<Response> {
  const v = validate(req, raw);
  if (!v.ok) {
    return new Response(v.message, { status: v.status });
  }

  // Verify signature before any provider env validation
  const { monitorSecrets, securityAlertSecrets } = loadSecrets(env);
  const secrets = isMonitorEvent(v.payload.event) ? monitorSecrets : securityAlertSecrets;
  const sig = req.headers.get("x-uptimemonitoring-signature");
  if (!(await verifySignature(raw, sig, secrets))) {
    return new Response("invalid signature", { status: 401 });
  }

  const cfg = loadConfig(env);

  if (cfg.providers.length === 0) {
    return Response.json(
      { ok: true, providersDispatched: 0, providersFailed: 0, results: [], event: v.payload.event, note: "no providers configured" },
      { status: 200 },
    );
  }

  type ProviderResult = { provider: string; ok: true } | { provider: string; ok: false; reason: string };
  const tasks = cfg.providers.map(async (name): Promise<ProviderResult> => {
    const p = lookupProvider(name)!; // safe: loadConfig threw for any unknown name
    const r = await p.send(v.payload, env);
    return r.ok ? { provider: name, ok: true } : { provider: name, ok: false, reason: r.reason };
  });

  const settled = await Promise.all(tasks);
  const succeeded = settled.filter((r): r is { provider: string; ok: true } => r.ok).map((r) => r.provider);
  const failures = settled.filter((r): r is { provider: string; ok: false; reason: string } => !r.ok).map((r) => r.provider);

  if (failures.length > 0) {
    return Response.json(
      { ok: false, failures, succeeded, results: settled, event: v.payload.event },
      { status: 500 },
    );
  }
  return Response.json(
    { ok: true, providersDispatched: succeeded.length, providersFailed: 0, results: settled, event: v.payload.event },
    { status: 200 },
  );
}

export { verifySignature } from "./auth.js";
export { ConfigError, loadConfig, loadSecrets } from "./config.js";
export { validate } from "./validate.js";
export type {
  Env,
  MonitorEvent,
  MonitorWebhookPayload,
  Provider,
  SecurityAlertPayload,
  SecurityEvent,
  WebhookPayload,
} from "./types.js";
export type { Config } from "./config.js";
export type { ValidationResult } from "./validate.js";
