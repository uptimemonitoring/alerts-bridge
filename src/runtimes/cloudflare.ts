import { handle } from "../index.js";
import type { Env } from "../types.js";

// Mirrors validate()'s 64 KB cap. Reject by Content-Length BEFORE materializing
// the body, so an oversized POST can't force a full read into Worker memory ahead
// of the shared guard. Requests without a Content-Length (e.g. chunked) still fall
// through to handle()/validate()'s post-read byteLength check.
const MAX_BODY_BYTES = 65536;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return new Response("request body too large", { status: 413 });
      }
    }
    const raw = new Uint8Array(await request.arrayBuffer());
    return handle(request, env, raw);
  },
};
