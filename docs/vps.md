# VPS deployment

## Choose the server

A small Linux VPS with 1 GB RAM is a reasonable starting point for a few quiet channels. Ubuntu 24.04 LTS or Debian 13 works well. No database server or web hosting package is required. The bot only makes outbound HTTPS and WebSocket connections; it needs no domain or inbound application ports.

Keep server addresses, account details and SSH keys outside this repository.

## Prepare Linux and Docker

Use SSH to log into your server. Install security updates, use a normal administrative account and SSH keys, and keep SSH access working while configuring any firewall. Only SSH needs inbound access for this bot.

Install Docker Engine and its Compose plugin using the instructions for your chosen OS:

- [Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Debian](https://docs.docker.com/engine/install/debian/)

Check:

```sh
sudo docker version
sudo docker compose version
sudo systemctl enable --now docker
```

Use `sudo docker` consistently if your account lacks Docker access. Membership in the Docker group grants substantial host privileges; it is optional.

## Transfer the project

Clone your repository or upload a copy over SSH. Public repositories can be cloned over HTTPS without credentials. For a private repository, use organization-approved authentication such as a GitHub App with read-only Contents permission. Do not bake Git credentials into the image. Work in the uploaded project directory for the following commands.

Only project files are needed: do not upload `node_modules`, `.git` credentials, old secret files or local runtime data. Docker installs production dependencies during the build.

## Add private configuration

```sh
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in the bot token and comma-separated channel IDs. Avoid putting a token directly into a shell command, which can record it in shell history. Copy values from Discord privately. If you no longer have the token, reset it in the Discord Developer Portal and use the replacement.

The existing Discord bot and invitation can be reused. Gateway connection only requires the unprivileged Guilds and Guild Messages intents, which the code requests automatically.

## Start and verify

```sh
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=50 -f bot
```

Look for `gateway_ready`, an online Discord status and a healthy container after roughly a minute. Ctrl+C exits the log viewer without stopping the bot.

In a test channel:

1. Send a normal post and confirm its thread appears promptly.
2. Send an attachment-only post and confirm it gets a thread.
3. Send two posts from the same author and confirm the second waits for the cooldown.
4. Send a post from another author during that cooldown and confirm it proceeds.
5. Restart the service and confirm it returns online and finishes queued posts.

```sh
sudo docker compose restart bot
```

The default cooldown is 60 seconds. Missing permissions usually produce a 403 or code 50013. Invalid tokens fail login; inaccessible channels fail startup checks. Logs deliberately do not print IDs or credentials.

## Update, pause and resume

After uploading or pulling a source update:

```sh
sudo docker compose up -d --build
sudo docker compose ps
```

To apply `.env` changes:

```sh
sudo docker compose up -d --force-recreate
```

Pause/resume:

```sh
sudo docker compose stop bot
sudo docker compose start bot
```

`restart: unless-stopped` restores the running bot after server reboots. A manually stopped container stays stopped until you start it.

## Back up progress

Stop the service briefly before copying the state:

```sh
sudo docker compose stop bot
sudo docker compose cp bot:/app/data/state.json ./state-backup.json
sudo chmod 600 ./state-backup.json
sudo docker compose start bot
```

Keep this backup outside Git; it contains Discord IDs. Restore it into `/app/data/state.json` while the container is stopped and ensure it is owned by container UID/GID 1000. Preserve the Docker volume when recreating containers. Do not use `docker compose down -v` unless you intend to delete progress and queued posts.
