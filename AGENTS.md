# Repository notes

- Runtime: Node.js 22.12+, discord.js, Docker Compose. Operational references are in `docs/`.
- Run `npm ci`, `npm test`, `npm run check`, and `bash -n scripts/deploy.sh scripts/update.sh` for relevant changes.
- Preserve the single-instance model, persistent queues, per-author cooldowns, and duplicate-thread prevention.
- Keep credentials, actual user/channel IDs, server addresses and personal paths out of tracked files. Do not print private environment files or runtime state.
- The deployment branch is trusted code. Build and test before replacing the running container, then check health and retain rollback.
- Publishing a commit can trigger deployment when the timer is enabled. Preserve environment files and the data volume during updates.
- Change deployed source through tested commits on the deployment branch. Keep real repository URLs and server configuration outside the tracked project.
- Use organization-approved repository authentication; do not weaken organization policy to enable deployment.
- The runtime state contains Discord IDs for recovery, but must not store message bodies or usernames. Logs must omit tokens, identifiers and response bodies.
