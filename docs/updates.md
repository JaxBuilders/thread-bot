# Automatic updates

The updater checks the configured GitHub branch every five minutes. A new commit triggers an image build using the locked npm dependencies and refreshed Node base image, tests without network access or credentials, a Compose configuration check, and a container restart. The old bot keeps running during the build and tests. A failed startup health check restores the previous image.

The token stays in `/opt/thread-bot/.env`; queues and cursors remain in the Docker volume. Only one bot instance runs at a time. Expect a short reconnect during deployment. Rolling back an image does not undo changes already made to Discord or migrate stored state backward.

## Initial setup

Install the service and timer from `scripts/` into `/etc/systemd/system/`. The server also needs Git and a dedicated read-only GitHub deploy key. Add that key under repository **Settings → Deploy keys**, leaving **Allow write access** unchecked.

Create `/etc/thread-bot/update.env` on the server (mode 600):

```sh
REPO_URL=git@github.com:REPOSITORY_OWNER/REPOSITORY_NAME.git
BRANCH=main
```

The URL and actual repository owner remain private server configuration, not project files. Generate `/etc/thread-bot/github-deploy` as an Ed25519 private key (mode 600), and pin GitHub's public host keys in `/etc/thread-bot/github-known-hosts`. Obtain host keys over authenticated HTTPS from [GitHub's metadata API](https://api.github.com/meta), or verify them against [GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).

Enable only after deploying a version that passes health checks:

```sh
systemctl daemon-reload
systemctl enable --now thread-bot-update.timer
systemctl start thread-bot-update.service
```

The remote branch must contain the VPS implementation. Until then the updater leaves the existing bot running. Avoid direct modifications to deployed source files: make changes in the repository, test, commit and push. Keep `.env` edits on the server.

## Operate

```sh
# Check status and next run
systemctl list-timers thread-bot-update.timer
journalctl -u thread-bot-update.service -n 50 --no-pager

# Update immediately
systemctl start thread-bot-update.service

# Pause automatic updates (bot stays running)
systemctl disable --now thread-bot-update.timer
```

Pause the timer before manually stopping the bot or troubleshooting a release; a new commit otherwise starts it again. Failed builds and deployments are retried on subsequent runs. A failed release must be fixed in Git or updates paused to stop retries.

The bot's health check verifies a Gateway connection and recent successful scans. Unit tests and health checks cannot guarantee every behavior in a new version. Only trusted contributors should push to the deployment branch: its code runs on your VPS, and deployment scripts run with administrative access.

Changes to systemd units require reinstalling them and `systemctl daemon-reload`. These are deliberately not automatically replaced by application updates.

## Dependency and operating-system updates

Use a dependency PR tool such as Dependabot to propose library updates; test and review them before merging. Commits update the app; there is no automatic npm upgrade on the VPS. Base images refresh when an application commit is deployed.

Operating-system updates are separate. Install Debian security updates and schedule reboots when required. The application timer does not upgrade the OS or Docker Engine.
