import { verifySignature } from "./auth.js";
import { loadConfig } from "./config.js";
import { lookupProvider } from "./providers/index.js";
import { isMonitorEvent } from "./types.js";
import { validate } from "./validate.js";

export async function handle(req: Request, env: import("./types.js").Env, raw: Uint8Array): Promise<Response> {
  const v = validate(req, raw);
  if (!v.ok) {
    return new Response(v.message, { status: v.status });
  }

  const cfg = loadConfig(env);
  const secrets = isMonitorEvent(v.payload.event)
    ? cfg.monitorSecrets
    : cfg.securityAlertSecrets;

  const sig = req.headers.get("x-uptimemonitoring-signature");
  if (!(await verifySignature(raw, sig, secrets))) {
    return new Response("invalid signature", { status: 401 });
  }

  if (cfg.providers.length === 0) {
    return Response.json(
      { providersDispatched: 0, providersFailed: 0, results: [], event: v.payload.event, note: "no providers configured" },
      { status: 200 },
    );
  }

  type Result = { provider: string; status: number; error?: string };
  const tasks = cfg.providers.map(async (name): Promise<Result> => {
    const p = lookupProvider(name);
    if (!p) return { provider: name, status: 0, error: "unknown provider" };
    try {
      return await p.send(v.payload, env);
    } catch (e) {
      return { provider: name, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const settled = await Promise.all(tasks);
  const dispatched = settled.filter((r) => !r.error).length;
  const failed = settled.length - dispatched;
  const status = dispatched > 0 ? 200 : 500;
  return Response.json({ providersDispatched: dispatched, providersFailed: failed, results: settled, event: v.payload.event }, { status });
}

export { verifySignature } from "./auth.js";
export { loadConfig } from "./config.js";
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
