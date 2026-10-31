#!/usr/bin/env bash
# Restores a backup of TasksPipes (the `taskspipes-restore` alias runs it).
#
#   restore.sh FILE              restore that backup: an archive of backup.sh (.tar.gz or .tar.gz.gpg), or a database
#                                dump made before an update (.dump, .sql.gz)
#   restore.sh --latest          the latest backup kept on this server
#   restore.sh --from-s3 NAME    download it from the S3-compatible storage first (NAME, or "latest")
#   restore.sh --list            the backups on this server and, when set up, on the S3-compatible storage
#
# Every piece of data of this instance is replaced with the backup's: this server's state is backed up first
# (backups/taskspipes-before-restore-…), so that a restore can be undone by restoring that one.
#
# Options:
#   --with-config         put back the configuration of the backup too (.env, backup.env, Caddy files); the default
#                         when there is none here. Without it, this server's .env is kept.
#   --domain NAME         the instance now answers at this address (another server, another name): APP_URL is set
#   --passphrase-file F   the passphrase of an encrypted backup (asked otherwise, unless backup.env has it)
#   --backup-env F        S3 settings and passphrase from this file (a copy of the old server's backup.env)
#   --no-safety-backup    do not back this server up first
#   --yes                 no questions
#   --extract-config      (for the installer) only write the backup's configuration here, nothing else
set -euo pipefail

DIR="${TP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
RCLONE_IMAGE="${BACKUP_RCLONE_IMAGE:-rclone/rclone:1.71}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

SOURCE="" FROM_S3="" LATEST=0 LIST=0 WITH_CONFIG="" DOMAIN="" PASS_FILE="" BACKUP_ENV="" SAFETY=1 YES=0 EXTRACT=0 FETCHED_TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --latest) LATEST=1 ;;
    --from-s3) FROM_S3="${2:-latest}"; shift ;;
    --list) LIST=1 ;;
    --with-config) WITH_CONFIG=1 ;;
    --keep-config) WITH_CONFIG=0 ;;
    --domain) DOMAIN="$2"; shift ;;
    --passphrase-file) PASS_FILE="$2"; shift ;;
    --backup-env) BACKUP_ENV="$2"; shift ;;
    --no-safety-backup) SAFETY=0 ;;
    --yes|-y) YES=1 ;;
    --extract-config) EXTRACT=1 ;;
    --fetched-to) FETCHED_TO="$2"; shift ;;
    -h|--help) sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown option: $1 (see --help)" ;;
    *) [ -z "$SOURCE" ] || die "One backup at a time."; SOURCE="$1" ;;
  esac
  shift
done
# The installer names a backup on S3 as s3:NAME.
case "$SOURCE" in s3:*) FROM_S3="${SOURCE#s3:}"; FROM_S3="${FROM_S3:-latest}"; SOURCE="" ;; esac

mkdir -p "$DIR"
cd "$DIR"
docker info >/dev/null 2>&1 || die "Docker is not reachable: run this as root (sudo) or as a member of the docker group."
[ -f docker-compose.yml ] || [ -f compose.yml ] || die "No compose file in $DIR: is TasksPipes installed here?"

TTY=""
if [ "$YES" = 0 ] && { exec 3</dev/tty; } 2>/dev/null; then TTY=1; fi
# Without a terminal to confirm on, only --yes restores.
[ "$YES" = 1 ] || [ -n "$TTY" ] || [ "$LIST" = 1 ] || [ "$EXTRACT" = 1 ] || die "No terminal to confirm the restore on: give --yes."
ask() { # ask VAR "Question" "default"
  local answer=""
  if [ -n "$TTY" ]; then read -r -u 3 -p "$(printf '\033[1m?\033[0m %s%s: ' "$2" "${3:+ [$3]}")" answer || true; fi
  printf -v "$1" '%s' "${answer:-$3}"
}
ask_secret() {
  local answer=""
  if [ -n "$TTY" ]; then read -r -s -u 3 -p "$(printf '\033[1m?\033[0m %s: ' "$2")" answer || true; echo >&2; fi
  printf -v "$1" '%s' "$answer"
}
yes_no() { case "$1" in y|Y|yes|YES|o|O|oui|true|1) return 0 ;; *) return 1 ;; esac; }

file_get() { if [ -f "$1" ]; then sed -n "s/^$2=//p" "$1" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; fi; }
env_get() { file_get .env "$1"; }
env_set() {
  if grep -q "^$1=" .env 2>/dev/null; then
    local tmp; tmp="$(mktemp .env.XXXXXX)"
    awk -v k="$1" -v v="$2" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
# Settings of the backups: --backup-env, then this server's backup.env, then the environment.
conf() { local v; v="$(file_get "${BACKUP_ENV:-/nonexistent}" "$1")"; [ -n "$v" ] || v="$(file_get backup.env "$1")"; [ -n "$v" ] || v="${!1:-}"; printf '%s' "$v"; }

mkdir -p backups
chmod 700 backups

# ---- Listing, and the S3-compatible storage ---------------------------------------------------------------------------------
S3_ENDPOINT="$(conf BACKUP_S3_ENDPOINT)" S3_REGION="$(conf BACKUP_S3_REGION)" S3_BUCKET="$(conf BACKUP_S3_BUCKET)"
S3_PREFIX="$(conf BACKUP_S3_PREFIX)" S3_ACCESS="$(conf BACKUP_S3_ACCESS_KEY_ID)" S3_SECRET="$(conf BACKUP_S3_SECRET_ACCESS_KEY)"
rclone() {
  local provider=Other
  [ -n "$S3_ENDPOINT" ] || provider=AWS
  RCLONE_CONFIG_TP_TYPE=s3 RCLONE_CONFIG_TP_PROVIDER="$provider" RCLONE_CONFIG_TP_ENDPOINT="$S3_ENDPOINT" \
  RCLONE_CONFIG_TP_REGION="$S3_REGION" RCLONE_CONFIG_TP_ACCESS_KEY_ID="$S3_ACCESS" RCLONE_CONFIG_TP_SECRET_ACCESS_KEY="$S3_SECRET" \
  RCLONE_CONFIG_TP_ENV_AUTH=false RCLONE_CONFIG_TP_NO_CHECK_BUCKET=true RCLONE_CONFIG=/tmp/rclone.conf \
    docker run --rm -i -v "$DIR/backups:/data" \
      -e RCLONE_CONFIG_TP_TYPE -e RCLONE_CONFIG_TP_PROVIDER -e RCLONE_CONFIG_TP_ENDPOINT -e RCLONE_CONFIG_TP_REGION \
      -e RCLONE_CONFIG_TP_ACCESS_KEY_ID -e RCLONE_CONFIG_TP_SECRET_ACCESS_KEY -e RCLONE_CONFIG_TP_ENV_AUTH \
      -e RCLONE_CONFIG_TP_NO_CHECK_BUCKET -e RCLONE_CONFIG \
      "$RCLONE_IMAGE" --log-level ERROR --retries 3 --low-level-retries 5 "$@"
}
remote_path() { printf 'tp:%s%s' "$S3_BUCKET" "${S3_PREFIX:+/$S3_PREFIX}"; }
remote_list() { rclone lsf "$(remote_path)" --files-only --include 'taskspipes-backup-*' | sort; }
local_list() {
  find backups -maxdepth 1 -type f \( -name 'taskspipes-*.tar.gz' -o -name 'taskspipes-*.tar.gz.gpg' -o -name 'taskspipes-*.dump' -o -name 'taskspipes-*.sql.gz' \) \
    -printf '%T@ %p\n' 2>/dev/null | sort -n | cut -d' ' -f2-
}

if [ "$LIST" = 1 ]; then
  say "Backups in $DIR/backups:"
  local_list | sed 's|^backups/|  |'
  if [ -n "$S3_BUCKET" ]; then
    say "Backups on s3:$S3_BUCKET${S3_PREFIX:+/$S3_PREFIX}:"
    remote_list | sed 's|^|  |' || warn "The storage could not be listed."
  fi
  exit 0
fi

if [ -n "$FROM_S3" ]; then
  if [ -z "$S3_BUCKET" ]; then
    [ -n "$TTY" ] || die "No S3-compatible storage known here: give --backup-env (a copy of backup.env), or the BACKUP_S3_* variables."
    say "Where are the backups? (the settings of the old server's backup.env)"
    ask S3_ENDPOINT "Endpoint URL (empty for AWS)" ""
    ask S3_REGION "Region (empty if none)" ""
    ask S3_BUCKET "Bucket" ""
    ask S3_PREFIX "Folder in the bucket" "taskspipes"
    ask S3_ACCESS "Access key" ""
    ask_secret S3_SECRET "Secret key"
    { [ -n "$S3_BUCKET" ] && [ -n "$S3_ACCESS" ] && [ -n "$S3_SECRET" ]; } || die "The bucket, access key and secret key are needed."
  fi
  if [ "$FROM_S3" = latest ]; then
    FROM_S3="$(remote_list | tail -n 1)" || die "Could not list s3:$S3_BUCKET${S3_PREFIX:+/$S3_PREFIX}: check its settings."
    [ -n "$FROM_S3" ] || die "No backup on s3:$S3_BUCKET${S3_PREFIX:+/$S3_PREFIX}."
  fi
  [[ "$FROM_S3" =~ ^taskspipes-[A-Za-z0-9._-]+$ ]] || die "Invalid backup name: $FROM_S3"
  say "Downloading $FROM_S3"
  rclone copyto "$(remote_path)/$FROM_S3" "/data/$FROM_S3" || die "Could not download $FROM_S3."
  chmod 600 "backups/$FROM_S3"
  SOURCE="$DIR/backups/$FROM_S3"
elif [ "$LATEST" = 1 ]; then
  SOURCE="$(local_list | grep '^backups/taskspipes-backup-' | tail -n 1)"
  [ -n "$SOURCE" ] || die "No backup in $DIR/backups."
  SOURCE="$DIR/$SOURCE"
fi
[ -n "$SOURCE" ] || die "Which backup? Give a file, --latest or --from-s3 (see --help)."
[ -f "$SOURCE" ] || die "No such file: $SOURCE"
SOURCE="$(cd "$(dirname "$SOURCE")" && pwd)/$(basename "$SOURCE")"
[ -z "$FETCHED_TO" ] || printf '%s\n' "$SOURCE" > "$FETCHED_TO"

# ---- Open the backup -----------------------------------------------------------------------------------------------------------
WORK="$(mktemp -d "$DIR/backups/.restore-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
umask 077
FORMAT="" ARCHIVE=""
case "$SOURCE" in
  *.tar.gz.gpg)
    command -v gpg >/dev/null || die "gpg is needed to open an encrypted backup: install it (apt install gnupg, dnf install gnupg2)."
    PASSPHRASE=""
    [ -z "$PASS_FILE" ] || PASSPHRASE="$(head -n 1 "$PASS_FILE")"
    [ -n "$PASSPHRASE" ] || PASSPHRASE="$(conf BACKUP_PASSPHRASE)"
    if [ -z "$PASSPHRASE" ]; then
      [ -n "$TTY" ] || die "This backup is encrypted: give its passphrase with --passphrase-file."
      ask_secret PASSPHRASE "Passphrase of the backup"
    fi
    home="$(mktemp -d)"
    if ! GNUPGHOME="$home" gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d -o "$WORK/archive.tar.gz" "$SOURCE" 3<<<"$PASSPHRASE" 2>"$WORK/err"; then
      GNUPGHOME="$home" gpgconf --kill gpg-agent 2>/dev/null || true
      rm -rf "$home"
      die "Could not decrypt it: wrong passphrase, or a damaged file. ($(tail -n 1 "$WORK/err"))"
    fi
    GNUPGHOME="$home" gpgconf --kill gpg-agent 2>/dev/null || true
    rm -rf "$home"
    ARCHIVE="$WORK/archive.tar.gz" FORMAT=archive ;;
  *.tar.gz) ARCHIVE="$SOURCE" FORMAT=archive ;;
  *.dump) FORMAT=custom ;;
  *.sql.gz) FORMAT=plain ;;
  *) die "Unknown kind of backup: $SOURCE (.tar.gz, .tar.gz.gpg, .dump or .sql.gz)" ;;
esac

manifest() { file_get "$WORK/data/manifest" "$1"; }
DUMP="$SOURCE"
if [ "$FORMAT" = archive ]; then
  mkdir -p "$WORK/data"
  tar -xzf "$ARCHIVE" -C "$WORK/data" --no-same-owner || die "Could not open the archive: damaged file?"
  rm -f "$WORK/archive.tar.gz"
  if [ ! -f "$WORK/data/manifest" ] || [ ! -f "$WORK/data/db.dump" ]; then die "Not a backup of TasksPipes: no manifest or database in it."; fi
  (cd "$WORK/data" && sha256sum --quiet -c SHA256SUMS) || die "The backup is damaged: its checksums do not match."
  [ "$(manifest format)" = 1 ] || die "This backup was made by a newer TasksPipes (format $(manifest format)): restore it with that version's scripts."
  DUMP="$WORK/data/db.dump"
  FORMAT=custom
fi
B_VERSION="$(manifest app_version)"
if [ -z "$B_VERSION" ]; then
  # Dumps made before an update: the version is in their name.
  B_VERSION="$(basename "$SOURCE" | sed -E -n 's/^taskspipes-(before-[a-z]+-)?(.+)-[0-9]{8}-[0-9]{6}\..*$/\2/p')"
fi
B_CONFIG="$(manifest config)"
semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; }
newest() { printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1; }

# ---- The configuration ---------------------------------------------------------------------------------------------------------
put_config() {
  local f
  for f in $B_CONFIG; do
    case "$f" in .env|backup.env|compose.override.yml|Caddyfile) ;; *) continue ;; esac
    [ -f "$WORK/data/config/$f" ] || continue
    if [ -f "$f" ] && ! cmp -s "$f" "$WORK/data/config/$f"; then cp -p "$f" "$f.before-restore"; fi
    cp "$WORK/data/config/$f" "$f"
    case "$f" in .env|backup.env) chmod 600 "$f" ;; *) chmod 644 "$f" ;; esac
  done
  # Paths of the old server.
  if grep -q '^PROJECT_DIR=' .env; then env_set PROJECT_DIR "$DIR"; fi
}
set_domain() {
  [ -n "$DOMAIN" ] || return 0
  DOMAIN="${DOMAIN#http://}" DOMAIN="${DOMAIN#https://}" DOMAIN="${DOMAIN%%/*}"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "Invalid address: $DOMAIN"
  env_set APP_URL "https://$DOMAIN"
  if grep -qs "Written by scripts/install.sh" Caddyfile; then
    awk -v host="$DOMAIN" '/^[^#[:space:]].*\{$/ && !done { print host " {"; done = 1; next } { print }' Caddyfile > Caddyfile.new && mv -f Caddyfile.new Caddyfile
  fi
}

if [ "$EXTRACT" = 1 ]; then
  [ -n "$B_CONFIG" ] || die "This backup holds no configuration (made with --db-only): install anew, then restore it."
  put_config
  set_domain
  say "Configuration of the backup written to $DIR ($B_CONFIG)."
  exit 0
fi

[ -f .env ] || [ -n "$B_CONFIG" ] || die "No .env here, and none in this backup: install TasksPipes first (scripts/install.sh), then restore it."
if [ -z "$WITH_CONFIG" ]; then
  WITH_CONFIG=0
  if [ ! -f .env ]; then
    WITH_CONFIG=1
  elif [ -n "$B_CONFIG" ] && [ -f "$WORK/data/config/.env" ] \
    && [ "$(file_get "$WORK/data/config/.env" APP_SECRET)" != "$(env_get APP_SECRET)" ]; then
    warn "The backup was made with another APP_SECRET than this server's: with this server's, the secrets kept in the database (Outline sessions, two-factor keys, secret settings) cannot be read."
    if [ -n "$TTY" ]; then
      ask TAKE "Put back the configuration of the backup (its .env; this one is kept as .env.before-restore)" "yes"
      if yes_no "$TAKE"; then WITH_CONFIG=1; fi
    else
      warn "Kept this server's .env (give --with-config to put back the backup's)."
    fi
  fi
fi

# ---- What will happen ----------------------------------------------------------------------------------------------------------
CUR_MODE="$(env_get TASKSPIPES_INSTALL)"
CUR_VERSION="$(env_get TASKSPIPES_VERSION)"
echo >&2
say "Restoring $(basename "$SOURCE")"
{
  printf '  Made on:      %s%s\n' "$(manifest created || true)" "$( [ -n "$(manifest host)" ] && printf ' on %s' "$(manifest host)")"
  printf '  Version:      %s\n' "${B_VERSION:-unknown}"
  printf '  Holds:        the database%s\n' "$( [ -n "$B_CONFIG" ] && printf ' and %s' "$B_CONFIG")"
  printf '  Into:         %s%s\n' "$DIR" "$( [ "$WITH_CONFIG" = 1 ] && echo ', with its configuration' || echo ", keeping this server's configuration")"
} >&2
if [ -n "$TTY" ]; then
  warn "Every piece of data of this instance will be replaced with the backup's."
  ask GO "Type 'restore' to go on" ""
  [ "$GO" = restore ] || die "Nothing changed."
fi

# ---- This server's state first -----------------------------------------------------------------------------------------------
db_running() { [ -n "$(docker compose ps -q --status running db 2>/dev/null)" ]; }
SAFETY_FILE=""
if [ "$SAFETY" = 1 ] && [ -f .env ] && db_running; then
  say "Backing up this server's state first"
  if [ -x scripts/backup.sh ] && scripts/backup.sh --kind before-restore --origin restore --no-upload; then
    SAFETY_FILE="$(cat backups/.last)"
  else
    die "This server could not be backed up: nothing changed (--no-safety-backup to restore anyway)."
  fi
fi

if [ "$WITH_CONFIG" = 1 ]; then put_config; fi
set_domain
[ -f .env ] || die "No .env here."

# A database of a newer version than the code: the code goes to that version first (a newer code reads older data).
TARGET="${CUR_VERSION:-latest}"
if semver "${B_VERSION:-}" && semver "$TARGET" && [ "$(newest "$TARGET" "$B_VERSION")" != "$TARGET" ]; then
  if [ "$CUR_MODE" = source ] || { [ -z "$CUR_MODE" ] && [ -d .git ]; }; then
    die "The backup comes from TasksPipes $B_VERSION, newer than this one ($TARGET): update first (taskspipes-update --version $B_VERSION), then restore."
  fi
  say "The backup comes from TasksPipes $B_VERSION: this instance moves to it (it ran $TARGET)."
  env_set TASKSPIPES_VERSION "$B_VERSION"
fi
MODE="$(env_get TASKSPIPES_INSTALL)"
[ -n "$MODE" ] || { if [ -d .git ]; then MODE=source; else MODE=image; fi; }

# ---- The database --------------------------------------------------------------------------------------------------------------
undo_hint() {
  if [ -n "$SAFETY_FILE" ]; then
    warn "This server's state before the restore is in $SAFETY_FILE: restore it with  $DIR/scripts/restore.sh --with-config $SAFETY_FILE"
  fi
}
psql_admin() { docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U taskspipes -d postgres "$@"; }

say "Stopping the app"
docker compose stop app >/dev/null 2>&1 || true
docker compose up -d db > "$WORK/up.log" 2>&1 || { cat "$WORK/up.log" >&2; undo_hint; die "The database does not start."; }
for _ in $(seq 1 60); do
  docker compose exec -T db pg_isready -U taskspipes -d postgres >/dev/null 2>&1 && break
  sleep 2
done
docker compose exec -T db pg_isready -U taskspipes -d postgres >/dev/null 2>&1 || { undo_hint; die "The database does not start: see docker compose logs db"; }

say "Replacing the database"
psql_admin -c 'DROP DATABASE IF EXISTS taskspipes WITH (FORCE)' -c 'CREATE DATABASE taskspipes OWNER taskspipes' \
  || { undo_hint; die "Could not recreate the database."; }
if [ "$FORMAT" = custom ]; then
  docker compose exec -T db pg_restore -U taskspipes -d taskspipes --no-owner --no-privileges --exit-on-error < "$DUMP" \
    || { undo_hint; die "The database could not be restored."; }
else
  gunzip -c "$DUMP" | docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U taskspipes -d taskspipes >/dev/null \
    || { undo_hint; die "The database could not be restored."; }
fi
# The app connects with the password of .env (the database volume may have been made with another one).
docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U taskspipes -d postgres -v pw="$(env_get POSTGRES_PASSWORD)" >/dev/null <<'SQL' \
  || warn "Could not set the database password: if the app cannot connect, check POSTGRES_PASSWORD in .env."
ALTER ROLE taskspipes PASSWORD :'pw';
SQL

# ---- Start ---------------------------------------------------------------------------------------------------------------------
say "Starting TasksPipes"
# The app's container is made anew (it keeps nothing): one left in a bad state by an earlier failed start cannot stay so.
docker compose rm -f -s app >/dev/null 2>&1 || true
up=(up -d --remove-orphans)
if [ "$MODE" = image ]; then
  docker compose pull --quiet app 2>/dev/null || true
  up+=(--no-build)
fi
docker compose "${up[@]}" > "$WORK/up.log" 2>&1 || { cat "$WORK/up.log" >&2; undo_hint; die "The data is restored, but TasksPipes does not start."; }
state=missing
deadline=$((SECONDS + HEALTH_TIMEOUT))
while [ $SECONDS -lt $deadline ]; do
  id="$(docker compose ps -q app 2>/dev/null || true)"
  state="$( [ -n "$id" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
  case "$state" in healthy|unhealthy|exited|dead) break ;; esac
  sleep 3
done
if [ "$state" != healthy ]; then
  undo_hint
  die "The data is restored, but the app is $state: see docker compose logs app"
fi

# The plan of the backups of this server (and of its backup.env), and the restore, in Administration › Backups.
if [ -x scripts/backup.sh ] && [ -f backup.env ]; then
  if [ "$(id -u)" = 0 ]; then scripts/backup.sh --apply-schedule || warn "The backup timer could not be set up: run taskspipes-backup --setup."; fi
fi
[ ! -x scripts/backup.sh ] || scripts/backup.sh --record-restore "$(basename "$SOURCE")" || true

echo >&2
say "Restored: TasksPipes runs with the data of $(basename "$SOURCE")."
url="$(env_get APP_URL)"
OLD_HOST="$(manifest host)"
if [ -n "$DOMAIN" ] || { [ -n "$OLD_HOST" ] && [ "$OLD_HOST" != "$(hostname)" ]; }; then
  cat >&2 <<EOF

  The instance came from another server$([ -n "$DOMAIN" ] && printf ' and now answers at %s' "$url"). Check:
    - DNS: the address points to this server (and ports 80 and 443 reach it, with Caddy);
$( [ -n "$DOMAIN" ] && cat <<EOT
    - Outline OAuth application: redirect URL $url/auth/outline/callback
    - OpenID Connect provider (if any): redirect URI $url/auth/oidc/callback
    - GitHub/GitLab webhooks of connected pipes: they call the old address (reconnect the pipes, or update the hooks);
    - calendar subscriptions (.ics links) and installed apps: people subscribe again from the new address;
    - push notifications: people turn them on again (Settings), the browser ties them to the address.
EOT
)
    - the old server: stop it once this one works (docker compose stop), so that nobody writes there any more.
EOF
fi
[ -z "$SAFETY_FILE" ] || say "To undo: $DIR/scripts/restore.sh --with-config $SAFETY_FILE"
exit 0
