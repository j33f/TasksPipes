#!/usr/bin/env bash
# Moves this TasksPipes instance to another server, in one command (the `taskspipes-transfer` alias runs it):
#
#   transfer.sh [user@]new-server [--domain tasks.example.com]
#
# Run it on the current server. Over SSH, it:
#   1. stops the app here (no change may be lost; the database keeps running), and backs everything up — the
#      database and the configuration, encrypted when backups are (taskspipes-backup --setup);
#   2. copies the backup to the new server, then installs TasksPipes there from it (scripts/install.sh --restore):
#      Docker if missing, the same version, the same secrets and settings, HTTPS with Caddy if this server has it;
#   3. once the new server answers, offers to stop TasksPipes here for good (its data stays, to go back if need be).
# If something fails, the app here starts again and nothing changed here.
#
# Options:
#   --domain NAME     the address of the instance on the new server, when it changes (APP_URL; see the checklist)
#   --dir DIR         where to install on the new server (default /opt/taskspipes)
#   --port N          SSH port of the new server
#   --identity FILE   SSH key to use
#   --keep-running    do not stop the app here meanwhile (what is changed after the backup is not moved)
#   --yes             no questions (the new server's sudo may still ask for a password)
#
# The SSH user must be root, or be allowed to use sudo on the new server.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="j33f/TasksPipes"
RAW="https://raw.githubusercontent.com/$REPO"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

TARGET="" DOMAIN="" RDIR=/opt/taskspipes PORT="" IDENTITY="" KEEP_RUNNING=0 YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift ;;
    --dir) RDIR="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --identity|-i) IDENTITY="$2"; shift ;;
    --keep-running) KEEP_RUNNING=1 ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown option: $1 (see --help)" ;;
    *) [ -z "$TARGET" ] || die "One server at a time."; TARGET="$1" ;;
  esac
  shift
done
[ -n "$TARGET" ] || die "To which server? transfer.sh [user@]new-server (see --help)"
[[ "$TARGET" =~ ^([A-Za-z0-9._-]+@)?[A-Za-z0-9.:_-]+$ ]] || die "Invalid server: $TARGET"
[[ "$RDIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "Invalid directory: $RDIR"
[ -z "$PORT" ] || [[ "$PORT" =~ ^[0-9]+$ ]] || die "--port is a number"
if [ -n "$DOMAIN" ]; then
  DOMAIN="${DOMAIN#http://}" DOMAIN="${DOMAIN#https://}" DOMAIN="${DOMAIN%%/*}"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "Invalid address: $DOMAIN"
fi

cd "$DIR"
[ -f .env ] || die "No .env in $DIR: is TasksPipes installed here?"
[ -x scripts/backup.sh ] || die "scripts/backup.sh is missing: update this instance first (taskspipes-update)."
[ "$(id -u)" = 0 ] || die "Run it as root: sudo $DIR/scripts/transfer.sh $TARGET"
docker info >/dev/null 2>&1 || die "Docker is not reachable."

TTY=""
if [ "$YES" = 0 ] && { exec 3</dev/tty; } 2>/dev/null; then TTY=1; fi
ask() {
  local answer=""
  if [ -n "$TTY" ]; then read -r -u 3 -p "$(printf '\033[1m?\033[0m %s%s: ' "$2" "${3:+ [$3]}")" answer || true; fi
  printf -v "$1" '%s' "${answer:-$3}"
}
yes_no() { case "$1" in y|Y|yes|YES|o|O|oui|true|1) return 0 ;; *) return 1 ;; esac; }
file_get() { if [ -f "$1" ]; then sed -n "s/^$2=//p" "$1" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; fi; }

# SSH as the person who ran sudo (their keys and known hosts), else as root.
AS=()
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ] && command -v runuser >/dev/null; then AS=(runuser -u "$SUDO_USER" --); fi
SSH_OPTS=(-o ConnectTimeout=15 -o ServerAliveInterval=30)
[ -z "$PORT" ] || SSH_OPTS+=(-p "$PORT")
[ -z "$IDENTITY" ] || SSH_OPTS+=(-i "$IDENTITY")
SCP_OPTS=(-q -o ConnectTimeout=15)
[ -z "$PORT" ] || SCP_OPTS+=(-P "$PORT")
[ -z "$IDENTITY" ] || SCP_OPTS+=(-i "$IDENTITY")
remote() { "${AS[@]}" ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
remote_tty() { "${AS[@]}" ssh -t "${SSH_OPTS[@]}" "$TARGET" "$@"; }

# ---- The new server ------------------------------------------------------------------------------------------------------------
say "Connecting to $TARGET"
RUID="$(remote 'id -u' </dev/null)" || die "Could not connect to $TARGET over SSH (try: ssh $TARGET)."
SUDO=""
[ "$RUID" = 0 ] || SUDO="sudo"
grep -q Linux <<<"$(remote "command -v curl >/dev/null && command -v tar >/dev/null && uname -s" </dev/null)" \
  || die "$TARGET must be a Linux server with curl and tar."
if remote "$SUDO test -f $(printf %q "$RDIR/.env")" </dev/null 2>/dev/null; then
  warn "TasksPipes is already installed in $RDIR on $TARGET: its data will be replaced with this instance's."
  EXISTS=1
else
  EXISTS=0
fi

VERSION="$(docker compose exec -T app node -p "require('./package.json').version" 2>/dev/null | tr -d '\r' || true)"
[ -n "$VERSION" ] || VERSION="$(file_get .env TASKSPIPES_VERSION)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || VERSION=""
PASSPHRASE="$(file_get backup.env BACKUP_PASSPHRASE)"

echo >&2
say "Moving TasksPipes${VERSION:+ $VERSION} from $(hostname) to $TARGET"
{
  printf '  Here:         %s (the app stops meanwhile%s)\n' "$DIR" "$([ "$KEEP_RUNNING" = 1 ] && echo ': no, --keep-running')"
  printf '  There:        %s%s\n' "$RDIR" "$([ "$EXISTS" = 1 ] && echo ' (existing installation: replaced)')"
  if [ -n "$DOMAIN" ]; then printf '  Address:      https://%s (changes)\n' "$DOMAIN"; else printf '  Address:      %s\n' "$(file_get .env APP_URL)"; fi
  printf '  Backup:       %s\n' "$([ -n "$PASSPHRASE" ] && echo 'encrypted (passphrase of backup.env)' || echo 'not encrypted (copied over SSH)')"
} >&2
if [ -n "$TTY" ]; then
  ask GO "Go on" "yes"
  yes_no "$GO" || die "Nothing changed."
fi

# ---- Back up, with the app stopped -----------------------------------------------------------------------------------------------
STOPPED=0
STAGE=""
RT=""
cleanup() {
  [ -z "$STAGE" ] || rm -rf "$STAGE"
  [ -z "$RT" ] || remote "rm -rf $(printf %q "$RT")" </dev/null >/dev/null 2>&1 || true
}
on_error() {
  cleanup
  if [ "$STOPPED" = 1 ]; then
    warn "Starting the app here again: this server is as it was."
    docker compose start app >/dev/null 2>&1 || docker compose up -d app >/dev/null 2>&1 || true
  fi
}
trap on_error EXIT
if [ "$KEEP_RUNNING" = 0 ]; then
  say "Stopping the app here (nothing changes while it moves)"
  docker compose stop app >/dev/null
  STOPPED=1
fi
scripts/backup.sh --origin transfer --no-upload
ARCHIVE="$(cat backups/.last)"
[ -f "$ARCHIVE" ] || die "The backup is missing."
FILE="$(basename "$ARCHIVE")"

# The installer of this version (it knows --restore), next to the backup.
STAGE="$(mktemp -d)"
cp "$ARCHIVE" "$STAGE/$FILE"
if [ -f scripts/install.sh ] && grep -q -- '--restore' scripts/install.sh; then
  cp scripts/install.sh "$STAGE/install.sh"
else
  ref=main
  [ -z "$VERSION" ] || ref="v$VERSION"
  curl -fsSL "$RAW/$ref/scripts/install.sh" -o "$STAGE/install.sh" \
    || curl -fsSL "$RAW/main/scripts/install.sh" -o "$STAGE/install.sh" || die "Could not get the installer."
fi
[ -z "$PASSPHRASE" ] || printf '%s\n' "$PASSPHRASE" > "$STAGE/passphrase"
chmod 600 "$STAGE"/*
if [ "${#AS[@]}" -gt 0 ]; then chown -R "$SUDO_USER" "$STAGE"; fi

say "Copying the backup to $TARGET"
RT="$(remote 'umask 077; mktemp -d /tmp/taskspipes-transfer-XXXXXX' </dev/null)"
[[ "$RT" =~ ^/tmp/taskspipes-transfer-[A-Za-z0-9]+$ ]] || die "Could not make a directory on $TARGET."
"${AS[@]}" scp "${SCP_OPTS[@]}" "$STAGE"/* "$TARGET:$RT/" || die "Could not copy the backup to $TARGET."

# ---- Install there -----------------------------------------------------------------------------------------------------------------
say "Installing TasksPipes on $TARGET from the backup"
args=(--dir "$RDIR" --restore "$RT/$FILE")
[ -z "$VERSION" ] || args+=(--version "$VERSION")
[ -z "$DOMAIN" ] || args+=(--domain "$DOMAIN")
[ -z "$PASSPHRASE" ] || args+=(--passphrase-file "$RT/passphrase")
[ "$YES" = 0 ] || args+=(--yes)
cmd="$SUDO bash $(printf %q "$RT/install.sh")"
for a in "${args[@]}"; do cmd+=" $(printf %q "$a")"; done
remote_tty "$cmd" || die "The installation on $TARGET failed (see above). This server starts again as it was."

# ---- Done --------------------------------------------------------------------------------------------------------------------------
trap - EXIT
cleanup
echo >&2
say "TasksPipes now runs on $TARGET, with the data of this server."
if [ "$STOPPED" = 1 ]; then
  STOP=yes
  [ -z "$TTY" ] || ask STOP "Stop TasksPipes here for good (its data stays here; 'no' starts it again)" "yes"
  if yes_no "$STOP"; then
    docker compose stop >/dev/null
    scripts/backup.sh --timer off || true
    say "Stopped here; its planned backups are off. To go back: cd $DIR && docker compose up -d && scripts/backup.sh --apply-schedule"
  else
    docker compose start app >/dev/null
    warn "Running here too: changes made here from now on are not on $TARGET."
  fi
else
  warn "This instance kept running: changes made here after the backup are not on $TARGET."
fi
cat >&2 <<EOF

  Next:
    - point the address$([ -n "$DOMAIN" ] && printf ' (%s)' "$DOMAIN") to $TARGET in your DNS, if not done yet;
    - sign in there and check Administration › Backups (the backups of this server do not move: they stay in $DIR/backups);
    - when the address changes: see the checklist printed above by the new server.
EOF
