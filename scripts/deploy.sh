#!/usr/bin/env bash
# Deploy a tested checkout while keeping the token and state outside Git.
set -Eeuo pipefail
source_dir="$(realpath "${1:?Usage: deploy.sh SOURCE_DIRECTORY REVISION}")"
revision="${2:?Revision required}"
[[ "$revision" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 2
app_dir="${APP_DIR:-/opt/thread-bot}"
export BOT_ENV_FILE="$app_dir/.env"
[[ -f "$source_dir/src/bot.js" && -f "$BOT_ENV_FILE" ]] || { echo 'Missing bot source or private environment'; exit 1; }
image="thread-bot:$revision"
previous="$(docker inspect --format '{{.Image}}' thread-bot-bot-1 2>/dev/null || true)"
if [[ -n "$previous" ]]; then docker tag "$previous" thread-bot:rollback; fi
# The build context excludes credentials. Tests run without network or credentials.
docker build --pull -t "$image" "$source_dir"
docker run --rm --network none --read-only --tmpfs /tmp:exec \
  -v "$source_dir/test:/app/test:ro" -v "$source_dir/scripts:/app/scripts:ro" "$image" node --test
export THREAD_BOT_IMAGE="$image"
docker compose -p thread-bot -f "$source_dir/compose.yaml" config --quiet
started=false
rollback() {
  local status=$?
  trap - ERR
  if [[ "$started" == true && -n "$previous" ]]; then
    echo 'Update failed; restoring previous image'
    THREAD_BOT_IMAGE=thread-bot:rollback docker compose -p thread-bot -f "$app_dir/compose.yaml" up -d --no-build --force-recreate
  fi
  exit "$status"
}
trap rollback ERR
started=true
docker compose -p thread-bot -f "$source_dir/compose.yaml" up -d --no-build --force-recreate
healthy=false
for attempt in $(seq 1 40); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' thread-bot-bot-1 2>/dev/null || true)"
  if [[ "$health" == healthy ]]; then healthy=true; break; fi
  if [[ "$health" == unhealthy ]]; then break; fi
  sleep 3
done
[[ "$healthy" == true ]]
# Promote only after health passes. Leave .env and all runtime data intact.
docker tag "$image" thread-bot:current
for name in src test scripts docs Dockerfile compose.yaml package.json package-lock.json README.md .dockerignore .env.example; do
  if [[ -e "$source_dir/$name" && "$source_dir" != "$app_dir" ]]; then cp -a "$source_dir/$name" "$app_dir/"; fi
done
printf '%s\n' "$revision" > "$app_dir/.deployed-revision"
echo 'Deployment healthy'
