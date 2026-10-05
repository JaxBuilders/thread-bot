# Bot behavior and development

A small Discord bot that creates a public thread for each new post in selected text channels. Run it continuously on a VPS or home server using Docker Compose.

## What it does

- Connects to Discord's Gateway and appears **online**, with **Watching for new posts**.
- Creates threads promptly when a message arrives. Additional posts from the same author are queued during a configurable cooldown; other authors can proceed.
- Supports text, attachment-only posts, replies, bot posts and webhook posts. Discord-generated system notices are excluded to avoid loops.
- Keeps the original message and attachments intact. Adds the author to the thread.
- Names threads from the first 32 characters of the message, adding `...` if truncated. Whitespace is normalized and Discord mention markup is cleaned. Attachment-only posts use the filename; empty posts use `New discussion`. Message content is fetched when processing and is never written to the queue or logs.
- Persists progress and queues in a Docker volume, catches up after restarts, and avoids duplicate threads by checking their starter-message IDs.
- Scans periodically as a fallback for missed Gateway events. Cooldown queues are checked every five seconds, with up to five completed threads per channel per scan.
- Automatically reconnects. Exits for a restart if its Gateway connection remains unavailable for three minutes.
- Shows an idle status when processing fails, writes numeric error codes without message content or identifying data, and exposes container health locally without publishing a port.

First startup begins with new posts rather than converting existing history. Posts made after that point remain recoverable from history. Up to three ordinary text channels are supported. A 60-second cooldown is the default; it delays thread creation, not message posting. Use Discord channel slowmode to limit posting itself.

## Discord application

Create a bot in the [Developer Portal](https://discord.com/developers/applications), enable Guild Install and invite it with the `bot` scope. The bot needs these channel permissions:

- View Channels
- Read Message History
- Send Messages
- Create Public Threads
- Send Messages in Threads

Members need permission to participate in threads. Enable **Message Content Intent** under Bot → Privileged Gateway Intents and save before deploying. Other privileged intents are unnecessary. The bot will show offline until this service starts. If you already created and invited the bot, reuse it and its token.

## Configuration

All configuration is supplied through `.env`, which Git and Docker build context exclude.

| Variable | Meaning | Default |
| --- | --- | --- |
| `DISCORD_TOKEN` | Bot token, not application ID or client secret | Required |
| `CHANNEL_IDS` | Comma-separated text-channel IDs, up to three | Required |
| `COOLDOWN_SECONDS` | Per-author, per-channel spacing; 0 disables | 60 |
| `AUTO_ARCHIVE_MINUTES` | Inactivity interval: 60, 1440, 4320, 10080 | 1440 |

Thread archiving does not delete discussions. Changing `.env` requires `docker compose up -d --force-recreate`; a restart alone does not reload container environment settings.

## Development

Node.js 22.12 or newer is required. The VPS needs only Docker, not a host Node installation.

```sh
npm ci
npm test
npm run check
cp .env.example .env
# Fill in test-channel credentials privately.
npm start
```

Tests use fake Discord responses and temporary state directories; they do not connect to Discord. Running `npm start` with real credentials performs real thread creation. Use a test channel and stop other instances first.

## Limitations

Online presence indicates a Gateway connection, not guaranteed successful processing. Container health additionally checks recent processing; missing permissions or API failures can leave posts queued. Persistent errors may block later processing within that channel until fixed. Posts deleted before processing cannot have threads. Cooldowns and Discord rate limits can delay busy-channel processing. Existing threads are not renamed.

Docker marks unhealthy containers but does not restart them solely for health-check failure. The bot's connection watchdog handles long Gateway disconnections; logs identify other failures for correction.

## References

- [Discord Gateway](https://docs.discord.com/developers/events/gateway)
- [discord.js](https://discord.js.org/docs/packages/discord.js/main)
- [Docker Compose](https://docs.docker.com/compose/)

## Automatic updates

See [automatic updates](updates.md). The VPS can check a selected Git branch every five minutes, test and build each new commit, and restore the previous image if the replacement fails its health check. Dependency upgrades remain explicit source changes; the service does not run uncontrolled package upgrades.
