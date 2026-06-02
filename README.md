# alerts-bridge

Webhook bridge that accepts Monitive deliveries and dispatches to a notification provider (Pushover, ntfy.sh, Slack, Discord, Telegram). MIT-licensed, open-source, runs on Cloudflare Workers / Vercel / Deno Deploy / AWS Lambda / VPS.

**Phase 2b — Pushover and ntfy providers live; Slack/Discord/Telegram next.**

## Providers

Providers are plugins that implement the `Provider` contract. Multiple providers can be configured simultaneously via a comma-separated `PROVIDER` env var (e.g. `PROVIDER=pushover,ntfy`).

### Pushover

| Variable | Description |
|---|---|
| `PROVIDER` | Set to `pushover` (or include in a comma-separated list) |
| `PUSHOVER_TOKEN` | Pushover application API token |
| `PUSHOVER_USER` | Pushover user or group key |

Pushover delivers push notifications to iOS, Android, and desktop. Down alerts and security emergencies use Pushover's emergency priority — the message retries every 30 seconds (up to Pushover's 50-retry / ~25-minute cap) and requires acknowledgment, bypassing Do Not Disturb. Pushover is a one-time purchase of $4.99 per platform (iOS/Android/Desktop client app); the API is free.

### ntfy

| Variable | Default | Description |
|---|---|---|
| `PROVIDER` | — | Set to `ntfy` (or include in a comma-separated list) |
| `NTFY_URL` | `https://ntfy.sh` | ntfy server base URL (self-hosted or ntfy.sh) |
| `NTFY_TOPIC` | *(required)* | Topic name to publish to |
| `NTFY_TOKEN` | *(optional)* | Bearer token for protected topics |

ntfy delivers push notifications via the ntfy.sh open-source pub/sub service. Public topics require no authentication; protected topics use `NTFY_TOKEN` as a Bearer token. Alerts are sent with ntfy's 1–5 priority scale:

| Priority | Events |
|---|---|
| 5 (urgent) | `down`, `kill_switch_flipped` (active), `account_suspended` |
| 4 (high) | `cap_hit`, `fleet_util_exceeded` |
| 3 (default) | `up`, `kill_switch_flipped` (inactive), `fleet_util_recovered` |
