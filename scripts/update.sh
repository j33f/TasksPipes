#!/usr/bin/env bash
# Updates a TasksPipes instance installed by scripts/install.sh (the `taskspipes-update` alias runs it).
#
#   update.sh               move to the latest release
#   update.sh --check       only tell whether a newer release exists
#   update.sh --version X   move to version X (e.g. 0.18.0)
#
# With the published images, it sets TASKSPIPES_VERSION in .env, refreshes docker-compose.yml from that release,
# pulls the image and restarts the app; built from the sources (a git checkout), it checks out the release's tag and
# rebuilds. Either way the database is backed up first (backups/, the last 5 kept), and the previous version is put
# back when the new one does not become healthy.
set -euo pipefail

REPO="j33f/TasksPipes"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

CHECK_ONLY=0
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --version) TARGET="${2:-}"; shift ;;
    --version=*) TARGET="${1#*=}" ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

cd "$DIR"
[ -f .env ] || die "No .env in $DIR: is TasksPipes installed here?"
docker info >/dev/null 2>&1 || die "Docker is not reachable: run this as root (sudo) or as a member of the docker group."

env_get() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '"'"'"; }
env_set() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}

latest_release() {
  curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1
}

# The newest of two versions (sort -V knows 1.10.0 > 1.9.0).
newest() { printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1; }

SOURCE=0
[ -d .git ] && SOURCE=1
if [ "$SOURCE" = 1 ]; then
  CURRENT="$(git describe --tags --exact-match 2>/dev/null | sed 's/^v//' || true)"
  CURRENT="${CURRENT:-$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' server/package.json | head -n 1)}"
else
  CURRENT="$(env_get TASKSPIPES_VERSION)"
fi
CURRENT="${CURRENT:-latest}"

if [ -z "$TARGET" ]; then
  TARGET="$(latest_release)" || true
  [ -n "$TARGET" ] || die "Could not learn the latest release from GitHub."
fi
[[ "$TARGET" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "Invalid version: $TARGET"

if [ "$CURRENT" = "$TARGET" ]; then
  say "TasksPipes $CURRENT is up to date."
  exit 0
fi
if [ "$CHECK_ONLY" = 1 ]; then
  if [ "$CURRENT" != "latest" ] && [ "$(newest "$CURRENT" "$TARGET")" = "$CURRENT" ]; then
    say "TasksPipes $CURRENT is up to date (latest release: $TARGET)."
  else
    say "TasksPipes $TARGET is available (this instance runs $CURRENT). Run: taskspipes-update"
  fi
  exit 0
fi

# ---- Back up the database --------------------------------------------------------------------------------------------
mkdir -p backups
chmod 700 backups
BACKUP="backups/taskspipes-$CURRENT-$(date +%Y%m%d-%H%M%S).sql.gz"
say "Backing up the database to $DIR/$BACKUP"
if docker compose exec -T db pg_dump -U taskspipes taskspipes | gzip > "$BACKUP"; then
  # shellcheck disable=SC2012 # names without spaces, made above
  ls -1t backups/taskspipes-*.sql.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
else
  rm -f "$BACKUP"
  die "The backup failed: nothing changed."
fi

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) id state
  while [ $SECONDS -lt $deadline ]; do
    id="$(docker compose ps -q app 2>/dev/null || true)"
    state="missing"
    [ -n "$id" ] && state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    case "$state" in
      healthy) return 0 ;;
      unhealthy|exited|dead) return 1 ;;
    esac
    sleep 3
  done
  return 1
}

# ---- Move to the new version -------------------------------------------------------------------------------------------
say "Updating TasksPipes from $CURRENT to $TARGET"
if [ "$SOURCE" = 1 ]; then
  PREVIOUS_REF="$(git rev-parse HEAD)"
  git fetch --quiet --tags origin
  git -c advice.detachedHead=false checkout --quiet "v$TARGET" || die "No tag v$TARGET: nothing changed."
  if docker compose up -d --build app && wait_healthy; then
    say "TasksPipes $TARGET is running."
    exit 0
  fi
  warn "The new version did not start: going back to $CURRENT."
  git -c advice.detachedHead=false checkout --quiet "$PREVIOUS_REF"
  docker compose up -d --build app || true
  die "Update failed; $CURRENT was put back (database backup: $DIR/$BACKUP)."
fi

cp .env .env.before-update
cp docker-compose.yml docker-compose.yml.before-update
restore() {
  mv -f .env.before-update .env
  mv -f docker-compose.yml.before-update docker-compose.yml
}
env_set TASKSPIPES_VERSION "$TARGET"
# The release's own compose file (new services, settings…); kept as it was when it cannot be fetched.
if curl -fsSL "https://raw.githubusercontent.com/$REPO/v$TARGET/docker-compose.yml" -o docker-compose.yml.new; then
  mv -f docker-compose.yml.new docker-compose.yml
else
  rm -f docker-compose.yml.new
  warn "Could not fetch the compose file of $TARGET: keeping the current one."
fi
if ! docker compose pull app; then
  restore
  die "TasksPipes $TARGET could not be downloaded: nothing changed."
fi
if docker compose up -d --remove-orphans && wait_healthy; then
  rm -f .env.before-update docker-compose.yml.before-update
  say "TasksPipes $TARGET is running."
  exit 0
fi
warn "The new version did not start: going back to $CURRENT."
restore
docker compose up -d --remove-orphans || true
die "Update failed; $CURRENT was put back (database backup: $DIR/$BACKUP)."
