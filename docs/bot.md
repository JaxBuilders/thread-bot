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

Startup configuration is supplied through `.env`, which Git and Docker build context exclude.
Channel behavior can also be changed through slash commands, with overrides stored in the private data volume.

| Variable | Meaning | Default |
| --- | --- | --- |
| `DISCORD_TOKEN` | Bot token, not application ID or client secret | Required |
| `CHANNEL_IDS` | Comma-separated text-channel IDs, up to three | Required |
| `COOLDOWN_SECONDS` | Per-author, per-channel spacing; 0 disables | 60 |
| `AUTO_ARCHIVE_MINUTES` | Inactivity interval: 60, 1440, 4320, 10080 | 1440 |

Thread archiving does not delete discussions. Changing `.env` requires `docker compose up -d --force-recreate`; a restart alone does not reload container environment settings.

## Slash commands

Use these in a watched text channel. **Manage Server** permission is required,
including when Discord command permissions are customized. Replies are private
to the person running the command. Each channel has independent settings.

| Command | Effect |
| --- | --- |
| `/threadbot settings` | Show current behavior and queued-post count |
| `/threadbot configure cooldown_seconds:120` | Space an author's threads two minutes apart (0 disables) |
| `/threadbot configure title_characters:40` | Use the first 40 message characters, then `...` if truncated |
| `/threadbot configure auto_archive_minutes:1440` | Archive future threads after one day of inactivity |
| `/threadbot pause` | Stop processing this channel; keep queued posts and catch up later |
| `/threadbot resume` | Resume processing, including posts sent while paused |
| `/threadbot reset` | Restore startup cooldown/archive defaults and 32-character titles; retain pause status |

The configure command accepts multiple options together. Cooldowns range from
0 to 86400 seconds, title lengths from 8 to 48 Unicode characters, and archive
times are selected from 1 hour, 1 day, 3 days, or 1 week. Changes apply to future
thread creation, including queued posts; existing threads and already-running
cooldown deadlines remain unchanged. Settings survive updates and restarts.
Reset clears behavior overrides to the current startup defaults and preserves
queued work. A long pause can produce a backlog when resumed.

The bot registers its command in servers containing watched channels on startup,
without removing other application commands. The `bot` invitation scope includes
`applications.commands` automatically, per the
[Discord application-command documentation](https://docs.discord.com/developers/interactions/application-commands).
If commands are hidden, check the server's app integration settings and the
member's Use Application Commands permission, then reopen Discord. Commands do
not add watched channels or modify credentials; those stay in private startup
configuration.

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
