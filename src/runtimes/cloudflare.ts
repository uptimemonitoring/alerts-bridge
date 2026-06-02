import { handle } from "../index.js";
import type { Env } from "../types.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const raw = new Uint8Array(await request.arrayBuffer());
    return handle(request, env, raw);
  },
};
