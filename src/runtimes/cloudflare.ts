import { handle } from "../index.js";
import type { Env } from "../types.js";

// Intentionally thin: all method/content-type/size/signature checks and the
// 405/415/413/401 responses live in handle()/validate(), so every runtime
// behaves identically. We materialize the body here because Cloudflare Workers
// bound request size at the platform layer and validate() enforces the 64 KB
// app cap; per-runtime streaming/early-cutoff (where it actually matters) is a
// Node-adapter concern, handled there rather than diverging the contract here.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const raw = new Uint8Array(await request.arrayBuffer());
    return handle(request, env, raw);
  },
};
