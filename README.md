# Thread Bot

Automatically attach public Discord threads to new messages in selected text channels. Hosted on Cloudflare Workers with a once-per-minute Cron Trigger. No always-on computer, Docker container, public web endpoint or domain is required.

## Behavior

- Every normal message or reply gets a thread, including attachment-only, bot and webhook posts. Discord-generated system messages are excluded.
- The original message, author and attachments remain in the channel. The bot adds the author to the thread.
- Titles are generic (`Discussion` plus a short message-ID suffix). Message Content Intent is not required.
- Per-author, per-channel cooldown defaults to 60 seconds. Extra posts are queued, not deleted or discarded. Other authors continue during that cooldown.
- This cooldown delays thread creation; it does not stop users posting. Set Discord channel slowmode separately if you want a posting limit.
- First activation starts with new posts, leaving historical messages untouched. An initial warm-up poll establishes the cursor; messages sent before that poll are not processed.
- Each channel ingests up to 100 posts and creates up to five threads per minute. Busy channels, queued posts, outages and rate limits can take longer than a minute. Cron timing is not a real-time guarantee.
- Up to three configured channels keep per-run Discord requests comfortably bounded. Use ordinary server text channels, not forums, DMs or existing threads.

A short-lived SQLite-backed Durable Object stores cursors, pending message/author IDs and cooldowns, and prevents overlapping poll runs. It does not maintain a WebSocket connection. Threads themselves provide deduplication after crashes. Removing a channel from configuration stops processing it but does not erase its stored state.

## Discord setup

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Install the bot in your server using the `bot` OAuth2 scope. Grant **View Channel**, **Read Message History**, **Send Messages**, **Create Public Threads**, and **Send Messages in Threads** in each watched channel. Administrator and Manage Messages are unnecessary.
3. Copy the bot token privately. Enable Developer Mode in Discord to copy the target text-channel IDs.
4. Users need access to the channel and **Send Messages in Threads** to participate. Consider pinning a notice asking people to reply in threads.

No privileged gateway intents are needed: this bot uses REST polling and does not read message text.

## Cloudflare deployment

Install Node.js 22 or newer and npm, then from this repository:

```sh
npm ci
npx wrangler login
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put CHANNEL_IDS
npm test
npm run check
npm run deploy
```

Enter the bot token at the first secret prompt, and comma-separated channel IDs at the second. Neither belongs in `wrangler.jsonc` or Git. If Wrangler asks to provision the Worker before setting secrets, allow it; then complete deployment.

Optional public settings in `wrangler.jsonc`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `COOLDOWN_SECONDS` | `60` | Per-author spacing between thread creations; `0` disables it |
| `AUTO_ARCHIVE_MINUTES` | `1440` | Archive after inactivity; allowed values: 60, 1440, 4320, 10080 |

Thread archiving does not delete the discussion. Deploy again after configuration changes. Cron changes can take up to 15 minutes to propagate.

```sh
npx wrangler tail
```

Logs contain counts and numeric API errors, without tokens, channel IDs, user IDs or message content. A 403 usually means channel permissions; 429 pauses polling according to Discord's retry delay. A failed post stays queued for retry. API permission or persistent failures can block later processing in that channel until corrected.

## Local testing

`npm test` uses fake Discord responses and does not contact Discord.

To run the Worker locally, copy `.dev.vars.example` to `.dev.vars`, fill it privately, then:

```sh
npm run dev
```

In another terminal:

```sh
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

This triggers **real Discord actions** when real credentials are supplied. Use a dedicated test channel. Trigger once to initialize and again after posting. Local storage is separate from production.

## Privacy and cost

Tracked files use no real personal, account or server identifiers. Tokens and channel IDs are deployment secrets; local secrets, Wrangler state and build output are ignored. Runtime state contains the Discord IDs necessary to process messages, but no message bodies or usernames. Do not commit logs, local state or credentials.

This architecture is intended for Cloudflare's free Workers and SQLite Durable Objects allowances at modest traffic. It is not a promise of unlimited free hosting; verify current quotas and monitor usage. Free-tier exhaustion can interrupt processing.

- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Discord message history API](https://docs.discord.com/developers/resources/message#get-channel-messages)
- [Discord thread creation API](https://docs.discord.com/developers/resources/channel#start-thread-from-message)

## Updating and stopping

Update dependencies, run tests and a dry-run build, then deploy. To pause the bot, remove the cron from `wrangler.jsonc` and deploy (allow for propagation), or disable the trigger in Cloudflare. Existing messages and threads are left intact.
