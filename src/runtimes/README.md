## Cloudflare Workers

`cloudflare.ts` — thin fetch-handler that reads the raw body as `Uint8Array` and delegates to `handle()`. No added logic; all validation, auth, and fan-out live in `src/index.ts`.

Configure with `wrangler.toml` at the repo root. See the "Deploy to Cloudflare Workers" section in the top-level README.

Other runtimes (Vercel, Deno Deploy, AWS Lambda, Node.js HTTP) are pending Phase 3.
