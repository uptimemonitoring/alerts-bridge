import { verifySignature } from "./auth.js";
import { loadConfig } from "./config.js";
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

  return Response.json(
    {
      providersDispatched: 0,
      note: "Phase 1 — no providers wired yet",
      event: v.payload.event,
    },
    { status: 200 },
  );
}

export { verifySignature } from "./auth.js";
export { loadConfig } from "./config.js";
export { validate } from "./validate.js";
export type {
  Env,
  MonitorEvent,
  MonitorWebhookPayload,
  SecurityAlertPayload,
  SecurityEvent,
  WebhookPayload,
} from "./types.js";
export type { Config } from "./config.js";
export type { ValidationResult } from "./validate.js";
