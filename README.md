# UptimeMonitoring Alerts Bridge

Webhook bridge that accepts Monitive deliveries and dispatches to a notification provider (Pushover, ntfy.sh, Slack, Discord, Telegram). MIT-licensed, open-source. Deploys to Cloudflare Workers today; the runtime-agnostic core (Vercel, Deno Deploy, AWS Lambda, and Node/VPS adapters) is on the roadmap.

All five providers — Pushover, ntfy, Slack, Discord, and Telegram — are live.

## Providers

Providers are plugins that implement the `Provider` contract. Multiple providers can be configured simultaneously via a comma-separated `PROVIDER` env var (e.g. `PROVIDER=pushover,ntfy`).

### Pushover

| Variable | Description |
|---|---|
| `PROVIDER` | Set to `pushover` (or include in a comma-separated list) |
| `PUSHOVER_TOKEN` | Pushover application API token |
| `PUSHOVER_USER` | Pushover user or group key |
| `PUSHOVER_DOWN_PRIORITY` | Optional. Pushover priority for `monitor.down` alerts, one of `-2,-1,0,1,2`. Defaults to `2` (emergency). Set `0` for a normal, non-waking notification. |

Pushover delivers push notifications to iOS, Android, and desktop. By default, down alerts and security emergencies use Pushover's emergency priority: the message retries every 30 seconds (up to Pushover's 50-retry / ~25-minute cap) and requires acknowledgment, bypassing Do Not Disturb. If you would rather not be woken for a down alert, set `PUSHOVER_DOWN_PRIORITY=0` (or `1` for high-without-retry); security emergencies stay at emergency priority regardless. Pushover is a one-time purchase of $4.99 per platform (iOS/Android/Desktop client app); the API is free.

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
| 5 (urgent) | `monitor.down`, `kill_switch_flipped` (active), `account_suspended`, `account_suspension_failed` |
| 4 (high) | `monitor.flapping`, `cap_hit`, `fleet_util_exceeded` |
| 3 (default) | `monitor.up`, `kill_switch_flipped` (inactive), `fleet_util_recovered` |

### Slack

| Variable | Description |
|---|---|
| `PROVIDER` | Set to `slack` (or include in a comma-separated list) |
| `SLACK_WEBHOOK_URL` | Incoming Webhook URL from your Slack app configuration |

Slack delivers alerts as message attachments with severity colors via an [Incoming Webhook](https://api.slack.com/messaging/webhooks). Create a Slack app, enable Incoming Webhooks, and copy the webhook URL into `SLACK_WEBHOOK_URL`. Alerts are color-coded:

| Color | Events |
|---|---|
| `danger` (red) | `monitor.down`, `kill_switch_flipped` (active), `account_suspended`, `account_suspension_failed` |
| `warning` (yellow) | `monitor.flapping`, `cap_hit`, `fleet_util_exceeded` |
| `good` (green) | `monitor.up`, `kill_switch_flipped` (inactive), `fleet_util_recovered` |

### Discord

| Variable | Description |
|---|---|
| `PROVIDER` | Set to `discord` (or include in a comma-separated list) |
| `DISCORD_WEBHOOK_URL` | Incoming Webhook URL from your Discord channel settings |

Discord delivers alerts as rich embeds with a color-coded left border via an [Incoming Webhook](https://discord.com/developers/docs/resources/webhook). Create a webhook in your channel's Integration settings and copy the URL into `DISCORD_WEBHOOK_URL`. Alerts are color-coded:

| Color | Events |
|---|---|
| Red (`#E01E5A`) | `monitor.down`, `kill_switch_flipped` (active), `account_suspended`, `account_suspension_failed` |
| Amber (`#F2C744`) | `monitor.flapping`, `cap_hit`, `fleet_util_exceeded` |
| Green (`#2EB67D`) | `monitor.up`, `kill_switch_flipped` (inactive), `fleet_util_recovered` |

### Telegram

| Variable | Description |
|---|---|
| `PROVIDER` | Set to `telegram` (or include in a comma-separated list) |
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Target chat, group, or channel ID (e.g. `-1001234567890`) |

Telegram delivers alerts as plain-text messages via the [Bot API](https://core.telegram.org/bots/api#sendmessage) `sendMessage` endpoint. Messages are sent without `parse_mode`, so monitor names containing Markdown metacharacters (`_`, `*`, `[`, `]`, `` ` ``) are delivered verbatim and cannot cause API errors.

## Deploy to Cloudflare Workers

```bash
npm install
```

Set secrets (`npx` resolves the `wrangler` devDependency installed above; repeat for each secret — values are never stored in `wrangler.toml`):

```bash
npx wrangler secret put PROVIDER                          # e.g. pushover
npx wrangler secret put MONITOR_WEBHOOK_SECRETS           # from Monitive webhook settings
npx wrangler secret put SECURITY_ALERT_WEBHOOK_SECRETS    # from Monitive webhook settings

# Pushover
npx wrangler secret put PUSHOVER_TOKEN
npx wrangler secret put PUSHOVER_USER
npx wrangler secret put PUSHOVER_DOWN_PRIORITY   # optional: -2..2 for monitor.down (default 2); set 0 to avoid waking

# ntfy (NTFY_URL defaults to https://ntfy.sh)
npx wrangler secret put NTFY_TOPIC
npx wrangler secret put NTFY_TOKEN    # optional, only for protected topics

# Slack
npx wrangler secret put SLACK_WEBHOOK_URL

# Discord
npx wrangler secret put DISCORD_WEBHOOK_URL

# Telegram
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Deploy:

```bash
npm run deploy
```

The resulting `*.workers.dev` URL (or your custom domain if configured) is the webhook endpoint to paste into Monitive's webhook settings.
