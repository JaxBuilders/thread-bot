#!/usr/bin/env bash
set -Eeuo pipefail
# Installed environment supplies REPO_URL and optionally BRANCH.
: "${REPO_URL:?Configure REPO_URL in /etc/thread-bot/update.env}"
branch="${BRANCH:-main}"
app_dir="${APP_DIR:-/opt/thread-bot}"
work_dir="${UPDATE_DIR:-/var/lib/thread-bot-updates}"
install -d -m 700 "$work_dir"
exec 9>"$work_dir/update.lock"
flock -n 9 || exit 0
export GIT_SSH_COMMAND='ssh -i /etc/thread-bot/github-deploy -o IdentitiesOnly=yes -o IdentityAgent=none -o ForwardAgent=no -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/thread-bot/github-known-hosts'
export GIT_TERMINAL_PROMPT=0
if [[ ! -d "$work_dir/repo.git" ]]; then git init --bare "$work_dir/repo.git" >/dev/null; fi
git --git-dir="$work_dir/repo.git" fetch --depth=1 "$REPO_URL" "$branch"
revision="$(git --git-dir="$work_dir/repo.git" rev-parse FETCH_HEAD)"
if [[ -f "$app_dir/.deployed-revision" && "$(cat "$app_dir/.deployed-revision")" == "$revision" ]]; then echo 'Already current'; exit 0; fi
# Use a fresh checkout. Old releases are cleaned up after success, not before.
release="$(mktemp -d "$work_dir/release.XXXXXXXX")"
trap 'rm -rf -- "$release"' EXIT
git --git-dir="$work_dir/repo.git" archive "$revision" | tar -x -C "$release"
if [[ ! -f "$release/src/bot.js" || ! -f "$release/scripts/deploy.sh" ]]; then
  echo 'Remote branch does not yet contain the VPS version; leaving current bot running'
  exit 0
fi
bash "$release/scripts/deploy.sh" "$release" "$revision"
# Bound retained application images to current and rollback; do not prune other apps.
current="$(docker image inspect thread-bot:current --format '{{.Id}}')"
previous="$(docker image inspect thread-bot:rollback --format '{{.Id}}' 2>/dev/null || true)"
while read -r tag id; do
  if [[ "$tag" =~ ^thread-bot:[0-9a-f]{40}$ && "$id" != "$current" && "$id" != "$previous" ]]; then docker image rm "$tag" >/dev/null || true; fi
done < <(docker image ls thread-bot --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}')
