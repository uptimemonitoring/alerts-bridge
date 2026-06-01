# alerts-bridge

Webhook bridge that accepts Monitive deliveries and dispatches to a notification provider (Pushover, ntfy.sh, Slack, Discord, Telegram). MIT-licensed, open-source, runs on Cloudflare Workers / Vercel / Deno Deploy / AWS Lambda / VPS.

**Phase 2a — Pushover provider live; ntfy/Slack/Discord/Telegram next.**

## Providers

Providers are plugins that implement the `Provider` contract. Multiple providers can be configured simultaneously via a comma-separated `PROVIDER` env var (e.g. `PROVIDER=pushover`). Slack support lands in Phase 2b.

### Pushover

| Variable | Description |
|---|---|
| `PROVIDER` | Set to `pushover` (or include in a comma-separated list) |
| `PUSHOVER_TOKEN` | Pushover application API token |
| `PUSHOVER_USER` | Pushover user or group key |

Pushover delivers push notifications to iOS, Android, and desktop. Down alerts and security emergencies use Pushover's emergency priority — the message retries every 30 seconds (up to Pushover's 50-retry / ~25-minute cap) and requires acknowledgment, bypassing Do Not Disturb. Pushover is a one-time purchase of $4.99 per platform (iOS/Android/Desktop client app); the API is free.
