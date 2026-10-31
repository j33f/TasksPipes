#!/usr/bin/env bash
# Backs up a TasksPipes instance installed with Docker Compose (the `taskspipes-backup` alias runs it).
#
#   backup.sh                   back up now: the database (files included) and the configuration, in backups/
#   backup.sh --setup           choose, by answering a few questions: automatic backups (none, daily or weekly), how
#                               many to keep, encryption with a passphrase, a copy on S3-compatible storage
#   backup.sh --status          the plan, the timer and the latest backups
#   backup.sh --list            the backups kept on this server; --list --remote: those on the S3-compatible storage
#
# A backup is one archive, backups/taskspipes-backup-<version>-<date>.tar.gz (.gpg once encrypted): the database
# (pg_dump), .env (with APP_SECRET, without which secrets kept in the database cannot be read), backup.env and the
# Caddy files of the installer, a manifest and their checksums. Restore it with scripts/restore.sh.
#
# Options of a backup:
#   --db-only           the database only: no .env, hence no secret, in the archive
#   --no-upload         keep it on this server, even when an S3-compatible copy is set up
#   --output DIR        write it to DIR instead of backups/
#   --passphrase-file F encrypt it with the passphrase in F (instead of the one of backup.env)
# Options of --setup (asked when missing; none asked with --yes):
#   --schedule none|daily|weekly   --at HH:MM (03:30)   --keep N (14)
#   --passphrase-file F | --generate-passphrase | --no-encryption
#   --s3-endpoint URL (empty for AWS)  --s3-region R  --s3-bucket B  --s3-prefix P (taskspipes)
#   --s3-access-key K  --s3-secret-key-file F  --s3-keep N (30)  | --no-s3
#   --yes
#
# Its settings are in backup.env, next to .env (chmod 600, not read by the app). Each backup is recorded in the
# database: Administration › Backups shows them, and administrators are told when one fails.
set -euo pipefail

DIR="${TP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RCLONE_IMAGE="${BACKUP_RCLONE_IMAGE:-rclone/rclone:1.71}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

ACTION=backup KIND=backup ORIGIN=manual DB_ONLY=0 UPLOAD=1 OUTPUT="" PASS_FILE="" YES=0 REMOTE_LIST=0
S_SCHEDULE="" S_AT="" S_KEEP="" S_ENC="" S_ENDPOINT="-" S_REGION="-" S_BUCKET="-" S_PREFIX="-" S_ACCESS="-" S_SECRET_FILE="" S_RKEEP="" S_NO_S3=0
RECORD_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --setup) ACTION=setup ;;
    --status) ACTION=status ;;
    --list) ACTION=list ;;
    --remote) REMOTE_LIST=1 ;;
    --db-only) DB_ONLY=1 ;;
    --no-upload) UPLOAD=0 ;;
    --output) OUTPUT="$2"; shift ;;
    --passphrase-file) PASS_FILE="$2"; shift ;;
    --scheduled) ORIGIN=scheduled ;;
    --kind) KIND="$2"; shift ;;
    --origin) ORIGIN="$2"; shift ;;
    --schedule) S_SCHEDULE="$2"; shift ;;
    --at) S_AT="$2"; shift ;;
    --keep) S_KEEP="$2"; shift ;;
    --generate-passphrase) S_ENC=generate ;;
    --no-encryption) S_ENC=none ;;
    --s3-endpoint) S_ENDPOINT="$2"; shift ;;
    --s3-region) S_REGION="$2"; shift ;;
    --s3-bucket) S_BUCKET="$2"; shift ;;
    --s3-prefix) S_PREFIX="$2"; shift ;;
    --s3-access-key) S_ACCESS="$2"; shift ;;
    --s3-secret-key-file) S_SECRET_FILE="$2"; shift ;;
    --s3-keep) S_RKEEP="$2"; shift ;;
    --no-s3) S_NO_S3=1 ;;
    --yes|-y) YES=1 ;;
    # For the other scripts: apply the schedule of backup.env (timer and plan), turn the timer off or on, record a restore.
    --apply-schedule) ACTION=apply ;;
    --timer) ACTION="timer-$2"; shift ;;
    --record-restore) ACTION=record-restore; RECORD_FILE="$2"; shift ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

cd "$DIR"
[ -f .env ] || die "No .env in $DIR: is TasksPipes installed here?"
docker info >/dev/null 2>&1 || die "Docker is not reachable: run this as root (sudo) or as a member of the docker group."

# ---- Settings ---------------------------------------------------------------------------------------------------------
# KEY=value lines, read without running them (a passphrase may hold any character).
file_get() { if [ -f "$1" ]; then sed -n "s/^$2=//p" "$1" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; fi; }
env_get() { file_get .env "$1"; }
conf() { file_get backup.env "$1"; }

SCHEDULE="$(conf BACKUP_SCHEDULE)"; SCHEDULE="${SCHEDULE:-none}"
AT="$(conf BACKUP_AT)"; AT="${AT:-03:30}"
KEEP="$(conf BACKUP_KEEP)"; KEEP="${KEEP:-14}"
PASSPHRASE="${BACKUP_PASSPHRASE:-$(conf BACKUP_PASSPHRASE)}"
S3_ENDPOINT="${BACKUP_S3_ENDPOINT-$(conf BACKUP_S3_ENDPOINT)}"
S3_REGION="${BACKUP_S3_REGION-$(conf BACKUP_S3_REGION)}"
S3_BUCKET="${BACKUP_S3_BUCKET-$(conf BACKUP_S3_BUCKET)}"
S3_PREFIX="${BACKUP_S3_PREFIX-$(conf BACKUP_S3_PREFIX)}"
S3_ACCESS="${BACKUP_S3_ACCESS_KEY_ID-$(conf BACKUP_S3_ACCESS_KEY_ID)}"
S3_SECRET="${BACKUP_S3_SECRET_ACCESS_KEY-$(conf BACKUP_S3_SECRET_ACCESS_KEY)}"
S3_KEEP="$(conf BACKUP_S3_KEEP)"; S3_KEEP="${S3_KEEP:-30}"
if [ -n "$PASS_FILE" ]; then
  [ -r "$PASS_FILE" ] || die "Cannot read $PASS_FILE"
  PASSPHRASE="$(head -n 1 "$PASS_FILE")"
fi

s3_on() { [ -n "$S3_BUCKET" ]; }
s3_where() { printf 's3:%s%s' "$S3_BUCKET" "${S3_PREFIX:+/$S3_PREFIX}"; }

# The systemd timer (or cron entry) of this installation.
UNIT=taskspipes-backup
[ "$DIR" = /opt/taskspipes ] || UNIT="taskspipes-backup-$(basename "$DIR" | tr -c 'A-Za-z0-9\n' '-')"
has_systemd() { command -v systemctl >/dev/null && [ -d /run/systemd/system ]; }

# ---- The database ---------------------------------------------------------------------------------------------------------
# psql in the db container, SQL on stdin, -v variables quoted by psql (never by the shell).
psql_db() { docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U taskspipes -d taskspipes "$@"; }
db_running() { [ -n "$(docker compose ps -q --status running db 2>/dev/null)" ]; }

# The version of TasksPipes running (or set to run), for the archive's name and manifest.
app_version() {
  local v
  v="$(docker compose exec -T app node -p "require('./package.json').version" 2>/dev/null | tr -d '\r' || true)"
  if [ -z "$v" ]; then v="$(env_get TASKSPIPES_VERSION)"; [ "$v" != latest ] || v=""; fi
  [ -n "$v" ] || v="$(git -C "$DIR" -c safe.directory="$DIR" describe --tags --exact-match 2>/dev/null | sed 's/^v//' || true)"
  [ -n "$v" ] || v="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' server/package.json 2>/dev/null | head -n 1)"
  [[ "$v" =~ ^[0-9A-Za-z.+-]+$ ]] || v=unknown
  printf '%s' "$v"
}

# Records a run (Administration › Backups). Older databases have no table for it: nothing then.
record_run() { # ok file size encrypted remote remote_ok error started version
  db_running || return 0
  psql_db -v kind="$KIND" -v origin="$ORIGIN" -v ok="$1" -v file="$2" -v size="$3" -v enc="$4" -v remote="$5" \
    -v remote_ok="$6" -v err="$7" -v started="$8" -v ver="$9" -v host="$(hostname)" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO backup_runs (kind, origin, ok, file, size_bytes, encrypted, remote, remote_ok, error, started_at, finished_at, app_version, host)
VALUES (:'kind', NULLIF(:'origin', ''), :'ok'::boolean, NULLIF(:'file', ''), NULLIF(:'size', '')::bigint, :'enc'::boolean,
        NULLIF(:'remote', ''), NULLIF(:'remote_ok', '')::boolean, NULLIF(left(:'err', 2000), ''), :'started'::timestamptz, now(),
        NULLIF(:'ver', ''), :'host');
SQL
}

record_plan() {
  db_running || return 0
  local remote="" rkeep="" enc=false
  if s3_on; then remote="$(s3_where)"; rkeep="$S3_KEEP"; fi
  [ -z "$PASSPHRASE" ] || enc=true
  psql_db -v schedule="$SCHEDULE" -v at="$AT" -v keep="$KEEP" -v enc="$enc" -v remote="$remote" -v rkeep="$rkeep" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO backup_plan (id, schedule, at, keep, encrypted, remote, remote_keep, updated_at)
VALUES (true, :'schedule', NULLIF(:'at', ''), NULLIF(:'keep', '')::integer, :'enc'::boolean, NULLIF(:'remote', ''), NULLIF(:'rkeep', '')::integer, now())
ON CONFLICT (id) DO UPDATE SET schedule = EXCLUDED.schedule, at = EXCLUDED.at, keep = EXCLUDED.keep, encrypted = EXCLUDED.encrypted,
  remote = EXCLUDED.remote, remote_keep = EXCLUDED.remote_keep,
  updated_at = CASE WHEN (backup_plan.schedule, backup_plan.at, backup_plan.keep, backup_plan.encrypted, backup_plan.remote)
                         IS NOT DISTINCT FROM (EXCLUDED.schedule, EXCLUDED.at, EXCLUDED.keep, EXCLUDED.encrypted, EXCLUDED.remote)
                    THEN backup_plan.updated_at ELSE now() END;
SQL
}

# ---- S3-compatible storage (rclone, in a container: nothing to install) ------------------------------------------------------
# Credentials go to the container through its environment (not on its command line).
rclone() { # rclone DIR_MOUNTED_AT_/data ARGS…
  local mount="$1"; shift
  local provider=Other
  [ -n "$S3_ENDPOINT" ] || provider=AWS
  RCLONE_CONFIG_TP_TYPE=s3 RCLONE_CONFIG_TP_PROVIDER="$provider" RCLONE_CONFIG_TP_ENDPOINT="$S3_ENDPOINT" \
  RCLONE_CONFIG_TP_REGION="$S3_REGION" RCLONE_CONFIG_TP_ACCESS_KEY_ID="$S3_ACCESS" RCLONE_CONFIG_TP_SECRET_ACCESS_KEY="$S3_SECRET" \
  RCLONE_CONFIG_TP_ENV_AUTH=false RCLONE_CONFIG_TP_NO_CHECK_BUCKET=true RCLONE_CONFIG=/tmp/rclone.conf \
    docker run --rm -i -v "$mount:/data" \
      -e RCLONE_CONFIG_TP_TYPE -e RCLONE_CONFIG_TP_PROVIDER -e RCLONE_CONFIG_TP_ENDPOINT -e RCLONE_CONFIG_TP_REGION \
      -e RCLONE_CONFIG_TP_ACCESS_KEY_ID -e RCLONE_CONFIG_TP_SECRET_ACCESS_KEY -e RCLONE_CONFIG_TP_ENV_AUTH \
      -e RCLONE_CONFIG_TP_NO_CHECK_BUCKET -e RCLONE_CONFIG \
      "$RCLONE_IMAGE" --log-level ERROR --retries 3 --low-level-retries 5 "$@"
}
remote_path() { printf 'tp:%s%s' "$S3_BUCKET" "${S3_PREFIX:+/$S3_PREFIX}"; }
remote_list() { rclone "$DIR/backups" lsf "$(remote_path)" --files-only --include 'taskspipes-backup-*' 2>/dev/null | sort; }

# ---- Encryption (gpg, symmetric AES-256) -------------------------------------------------------------------------------------
need_gpg() {
  command -v gpg >/dev/null && return 0
  [ "$(id -u)" = 0 ] || die "gpg is needed to encrypt backups: install it (gnupg)."
  say "Installing gpg (to encrypt backups)"
  if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gnupg >/dev/null
  elif command -v dnf >/dev/null; then dnf -q -y install gnupg2 >/dev/null
  elif command -v yum >/dev/null; then yum -q -y install gnupg2 >/dev/null
  fi
  command -v gpg >/dev/null || die "gpg is needed to encrypt backups: install it (gnupg)."
}
encrypt() { # encrypt IN OUT
  local home rc=0
  home="$(mktemp -d)"
  GNUPGHOME="$home" gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 \
    --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo none -o "$2" "$1" 3<<<"$PASSPHRASE" || rc=$?
  GNUPGHOME="$home" gpgconf --kill gpg-agent 2>/dev/null || true
  rm -rf "$home"
  return "$rc"
}

# ---- Timer ---------------------------------------------------------------------------------------------------------------------
timer_off() {
  if has_systemd; then
    systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$UNIT.timer" "/etc/systemd/system/$UNIT.service"
    systemctl daemon-reload
  fi
  rm -f "/etc/cron.d/$UNIT"
}
timer_on() {
  [ "$(id -u)" = 0 ] || die "Planning backups needs root: run it with sudo."
  [[ "$AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "Invalid time: $AT (HH:MM)"
  timer_off
  [ "$SCHEDULE" != none ] || return 0
  local script="$DIR/scripts/backup.sh"
  if has_systemd; then
    cat > "/etc/systemd/system/$UNIT.service" <<EOF
# Written by scripts/backup.sh: a planned backup of TasksPipes ($DIR).
[Unit]
Description=Back up TasksPipes ($DIR)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=$script --scheduled
EOF
    cat > "/etc/systemd/system/$UNIT.timer" <<EOF
# Written by scripts/backup.sh: when TasksPipes ($DIR) is backed up (backup.env, BACKUP_SCHEDULE).
[Unit]
Description=Back up TasksPipes ($DIR), $SCHEDULE

[Timer]
OnCalendar=$([ "$SCHEDULE" = weekly ] && printf 'Sun ')*-*-* $AT:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$UNIT.timer" >/dev/null
  elif [ -d /etc/cron.d ]; then
    printf '# Written by scripts/backup.sh: when TasksPipes (%s) is backed up.\n%s %s * * %s root %s --scheduled >> /var/log/%s.log 2>&1\n' \
      "$DIR" "$((10#${AT#*:}))" "$((10#${AT%:*}))" "$([ "$SCHEDULE" = weekly ] && echo 0 || echo '*')" "$script" "$UNIT" > "/etc/cron.d/$UNIT"
  else
    die "Neither systemd nor cron here: plan '$script --scheduled' with your own scheduler."
  fi
}
timer_state() {
  if has_systemd && systemctl is-enabled "$UNIT.timer" >/dev/null 2>&1; then
    systemctl list-timers --no-legend "$UNIT.timer" 2>/dev/null | awk '{ print "on, next run " $1 " " $2 " " $3 }' || true
  elif [ -f "/etc/cron.d/$UNIT" ]; then echo "on (cron: /etc/cron.d/$UNIT)"
  else echo "off"
  fi
}

case "$ACTION" in
  apply) timer_on; record_plan; exit 0 ;;
  timer-off) timer_off; exit 0 ;;
  timer-on) timer_on; exit 0 ;;
  record-restore)
    KIND=restore ORIGIN=restore
    record_plan
    record_run true "$RECORD_FILE" "" false "" "" "" "$(date -u +%FT%TZ)" "$(app_version)"
    exit 0 ;;
esac

# ---- --status and --list ---------------------------------------------------------------------------------------------------
local_list() {
  find backups -maxdepth 1 -type f \( -name 'taskspipes-*.tar.gz' -o -name 'taskspipes-*.tar.gz.gpg' -o -name 'taskspipes-*.dump' -o -name 'taskspipes-*.sql.gz' \) \
    -printf '%TY-%Tm-%Td %TH:%TM  %10s  %f\n' 2>/dev/null | sort
}
if [ "$ACTION" = list ]; then
  if [ "$REMOTE_LIST" = 1 ]; then
    s3_on || die "No S3-compatible storage set up (taskspipes-backup --setup)."
    say "Backups on $(s3_where):"
    remote_list
  else
    say "Backups in $DIR/backups (date, bytes, name):"
    local_list
  fi
  exit 0
fi
if [ "$ACTION" = status ]; then
  printf 'Installation:   %s\n' "$DIR"
  printf 'Schedule:       %s%s\n' "$SCHEDULE" "$([ "$SCHEDULE" = none ] || printf ' at %s%s' "$AT" "$([ "$SCHEDULE" = weekly ] && echo ' on Sundays')")"
  printf 'Timer:          %s\n' "$(timer_state)"
  printf 'Kept here:      the last %s\n' "$KEEP"
  printf 'Encryption:     %s\n' "$([ -n "$PASSPHRASE" ] && echo "on (passphrase in $DIR/backup.env)" || echo off)"
  printf 'Off-site copy:  %s\n' "$(s3_on && printf '%s (the last %s kept)' "$(s3_where)" "$S3_KEEP" || echo none)"
  echo
  say "Latest backups here:"
  local_list | tail -n 5
  if has_systemd && systemctl is-enabled "$UNIT.timer" >/dev/null 2>&1; then
    echo
    say "Last planned runs (journalctl -u $UNIT):"
    journalctl -u "$UNIT" -n 5 --no-pager -o short 2>/dev/null | tail -n 5 || true
  fi
  exit 0
fi

# ---- --setup ---------------------------------------------------------------------------------------------------------------
if [ "$ACTION" = setup ]; then
  [ "$(id -u)" = 0 ] || die "Run it as root: sudo $DIR/scripts/backup.sh --setup"
  TTY=""
  if [ "$YES" = 0 ] && { exec 3</dev/tty; } 2>/dev/null; then TTY=1; fi
  ask() { # ask VAR "Question" "default"
    local answer=""
    if [ -n "$TTY" ]; then read -r -u 3 -p "$(printf '\033[1m?\033[0m %s%s: ' "$2" "${3:+ [$3]}")" answer || true; fi
    printf -v "$1" '%s' "${answer:-$3}"
  }
  ask_secret() { # ask_secret VAR "Question"
    local answer=""
    if [ -n "$TTY" ]; then read -r -s -u 3 -p "$(printf '\033[1m?\033[0m %s: ' "$2")" answer || true; echo >&2; fi
    printf -v "$1" '%s' "$answer"
  }
  yes_no() { case "$1" in y|Y|yes|YES|o|O|oui|true|1) return 0 ;; *) return 1 ;; esac; }
  new_passphrase() { head -c 24 /dev/urandom | base64 | tr '+/' '-_'; }
  [ -z "$TTY" ] || say "Backups of $DIR (Enter keeps the suggestion)"

  [ -n "$S_SCHEDULE" ] || ask S_SCHEDULE "Automatic backups: none, daily or weekly (Sundays)" "$SCHEDULE"
  case "$S_SCHEDULE" in none|daily|weekly) SCHEDULE="$S_SCHEDULE" ;; *) die "--schedule is none, daily or weekly" ;; esac
  if [ "$SCHEDULE" != none ]; then
    [ -n "$S_AT" ] || ask S_AT "At what time (HH:MM, this server's time)" "$AT"
    AT="$S_AT"
  fi
  [[ "$AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "Invalid time: $AT (HH:MM)"
  [ -n "$S_KEEP" ] || ask S_KEEP "How many backups to keep on this server" "$KEEP"
  [[ "$S_KEEP" =~ ^[1-9][0-9]*$ ]] || die "--keep is a number (1 or more)"
  KEEP="$S_KEEP"

  # Encryption: needed for copies sent off this server.
  NEW_PASS=0
  if [ -n "$PASS_FILE" ]; then
    : # the passphrase of that file
  elif [ "$S_ENC" = none ]; then
    PASSPHRASE=""
  elif [ "$S_ENC" = generate ]; then
    PASSPHRASE="$(new_passphrase)"; NEW_PASS=1
  elif [ -n "$TTY" ]; then
    ask ENC "Encrypt backups with a passphrase (needed for a copy on S3-compatible storage)" "$({ [ -n "$PASSPHRASE" ] || [ -n "$S3_BUCKET" ]; } && echo yes || echo no)"
    if yes_no "$ENC"; then
      KEEP_PASS=no
      [ -z "$PASSPHRASE" ] || ask KEEP_PASS "Keep the current passphrase (no: choose another one; older backups keep theirs)" "yes"
      if ! yes_no "$KEEP_PASS"; then
        ask_secret P1 "Passphrase (12 characters or more; empty: one is made for you)"
        if [ -z "$P1" ]; then
          PASSPHRASE="$(new_passphrase)"
        else
          ask_secret P2 "Again"
          [ "$P1" = "$P2" ] || die "The two passphrases differ: nothing changed."
          PASSPHRASE="$P1"
        fi
        NEW_PASS=1
      fi
    else
      PASSPHRASE=""
    fi
  fi
  [ -z "$PASSPHRASE" ] || [ "${#PASSPHRASE}" -ge 12 ] || die "The passphrase must have 12 characters or more."
  [ -z "$PASSPHRASE" ] || need_gpg

  # S3-compatible storage.
  if [ "$S_NO_S3" = 1 ]; then
    S3_BUCKET=""
  elif [ "$S_BUCKET" != "-" ] || [ -n "$TTY" ]; then
    S3=yes
    [ "$S_BUCKET" != "-" ] || ask S3 "Copy each backup to S3-compatible storage (AWS, Scaleway, OVH, Backblaze B2, Wasabi, MinIO, Cloudflare R2…)" "$([ -n "$S3_BUCKET" ] && echo yes || echo no)"
    if yes_no "$S3"; then
      [ "$S_ENDPOINT" != "-" ] || ask S_ENDPOINT "Endpoint URL (e.g. https://s3.fr-par.scw.cloud; empty for AWS)" "$S3_ENDPOINT"
      [ "$S_REGION" != "-" ] || ask S_REGION "Region (e.g. fr-par, eu-west-3; empty if none)" "$S3_REGION"
      [ "$S_BUCKET" != "-" ] || ask S_BUCKET "Bucket (it must exist)" "$S3_BUCKET"
      [ "$S_PREFIX" != "-" ] || ask S_PREFIX "Folder in the bucket" "${S3_PREFIX:-taskspipes}"
      [ "$S_ACCESS" != "-" ] || ask S_ACCESS "Access key" "$S3_ACCESS"
      if [ -n "$S_SECRET_FILE" ]; then
        [ -r "$S_SECRET_FILE" ] || die "Cannot read $S_SECRET_FILE"
        S3_SECRET="$(head -n 1 "$S_SECRET_FILE")"
      elif [ -n "$TTY" ]; then
        ask_secret S_SECRET "Secret key$([ -n "$S3_SECRET" ] && echo ' (empty: keep the current one)')"
        [ -z "$S_SECRET" ] || S3_SECRET="$S_SECRET"
      fi
      [ -n "$S_RKEEP" ] || ask S_RKEEP "How many backups to keep there" "$S3_KEEP"
      S3_ENDPOINT="${S_ENDPOINT%/}" S3_REGION="$S_REGION" S3_BUCKET="$S_BUCKET" S3_PREFIX="${S_PREFIX#/}" S3_ACCESS="$S_ACCESS" S3_KEEP="$S_RKEEP"
      S3_PREFIX="${S3_PREFIX%/}"
      { [ -n "$S3_BUCKET" ] && [ -n "$S3_ACCESS" ] && [ -n "$S3_SECRET" ]; } || die "The bucket, access key and secret key are needed."
      [[ "$S3_KEEP" =~ ^[1-9][0-9]*$ ]] || die "--s3-keep is a number (1 or more)"
      [ -z "$S3_ENDPOINT" ] || [[ "$S3_ENDPOINT" =~ ^https?://[^[:space:]]+$ ]] || die "Invalid endpoint: $S3_ENDPOINT"
      [[ "$S3_BUCKET" =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid bucket name: $S3_BUCKET"
      [[ "$S3_PREFIX" =~ ^[A-Za-z0-9._/-]*$ ]] || die "Invalid folder: $S3_PREFIX"
      [ -n "$PASSPHRASE" ] || die "Copies sent off this server are always encrypted: set a passphrase (or --generate-passphrase)."
      say "Checking that the storage can be written to"
      mkdir -p backups && chmod 700 backups
      probe=".taskspipes-write-test-$$"
      if ! printf 'TasksPipes write test\n' | rclone "$DIR/backups" rcat "$(remote_path)/$probe" >/dev/null; then
        die "Could not write to $(s3_where): check the endpoint, region, bucket and keys. Nothing changed."
      fi
      rclone "$DIR/backups" deletefile "$(remote_path)/$probe" >/dev/null 2>&1 \
        || warn "The test file $probe could not be deleted (no right to delete?): older backups will not be removed there either."
      say "The storage works."
    else
      S3_BUCKET=""
    fi
  fi

  # backup.env: written whole, private.
  umask 077
  {
    echo "# Written by scripts/backup.sh --setup on $(date -u +%Y-%m-%d): how TasksPipes is backed up (see docs/HOSTING.md)."
    echo "# Keep a copy of BACKUP_PASSPHRASE away from this server: without it, encrypted backups cannot be restored."
    echo "BACKUP_SCHEDULE=$SCHEDULE"
    echo "BACKUP_AT=$AT"
    echo "BACKUP_KEEP=$KEEP"
    echo "BACKUP_PASSPHRASE=$PASSPHRASE"
    if s3_on; then
      echo "BACKUP_S3_ENDPOINT=$S3_ENDPOINT"
      echo "BACKUP_S3_REGION=$S3_REGION"
      echo "BACKUP_S3_BUCKET=$S3_BUCKET"
      echo "BACKUP_S3_PREFIX=$S3_PREFIX"
      echo "BACKUP_S3_ACCESS_KEY_ID=$S3_ACCESS"
      echo "BACKUP_S3_SECRET_ACCESS_KEY=$S3_SECRET"
      echo "BACKUP_S3_KEEP=$S3_KEEP"
    fi
  } > backup.env.new
  umask 022
  mv -f backup.env.new backup.env
  chmod 600 backup.env
  timer_on
  record_plan

  echo >&2
  say "Backups set up."
  {
    printf '  Automatic:   %s\n' "$([ "$SCHEDULE" = none ] && echo "none (back up with taskspipes-backup)" || printf '%s at %s%s' "$SCHEDULE" "$AT" "$([ "$SCHEDULE" = weekly ] && echo ' on Sundays')")"
    printf '  Kept here:   the last %s, in %s/backups\n' "$KEEP" "$DIR"
    printf '  Encrypted:   %s\n' "$([ -n "$PASSPHRASE" ] && echo yes || echo no)"
    printf '  Off-site:    %s\n' "$(s3_on && printf '%s (the last %s)' "$(s3_where)" "$S3_KEEP" || echo none)"
  } >&2
  if [ "$NEW_PASS" = 1 ]; then
    cat >&2 <<EOF

  $(printf '\033[1;33m')The passphrase of the backups:$(printf '\033[0m')

      $PASSPHRASE

  Keep it now in a safe place AWAY from this server (a password manager): an encrypted backup cannot be restored
  without it, and the copy kept in $DIR/backup.env goes if this server goes.
EOF
  fi
  if [ -n "$TTY" ]; then
    ask NOW "Make a first backup now" "yes"
    if yes_no "$NOW"; then exec "$DIR/scripts/backup.sh"; fi
  fi
  exit 0
fi

# ---- A backup ------------------------------------------------------------------------------------------------------------------
case "$KIND" in backup|before-update|before-restore|before-install) ;; *) die "Unknown kind: $KIND" ;; esac
STARTED="$(date -u +%FT%TZ)"
OUT="${OUTPUT:-$DIR/backups}"
mkdir -p "$OUT"
[ -n "$OUTPUT" ] || chmod 700 "$OUT"
OUT="$(cd "$OUT" && pwd)"

# One at a time.
exec 9>"$OUT/.backup.lock"
flock -n 9 || die "A backup is already running."

VERSION="$(app_version)"
NAME="taskspipes-$KIND-$VERSION-$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d "$OUT/.work-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ENCRYPTED=false
[ -z "$PASSPHRASE" ] || ENCRYPTED=true

fail() {
  record_run false "" "" "$ENCRYPTED" "" "" "$1" "$STARTED" "$VERSION"
  die "$1"
}

db_running || fail "The database is not running (docker compose up -d db): no backup made."
say "Backing up TasksPipes $VERSION ($DIR)"
mkdir -p "$WORK/data"
if ! docker compose exec -T db pg_dump -U taskspipes -Fc taskspipes > "$WORK/data/db.dump" 2> "$WORK/err"; then
  fail "pg_dump failed: $(tail -n 3 "$WORK/err" | tr '\n' ' ')"
fi
# A dump that pg_restore can read back.
docker compose exec -T db pg_restore --list < "$WORK/data/db.dump" > /dev/null 2> "$WORK/err" \
  || fail "The dump cannot be read back: $(tail -n 3 "$WORK/err" | tr '\n' ' ')"
PG_VERSION="$(psql_db -At -c 'SHOW server_version' 2>/dev/null | tr -d '\r' || true)"

FILES=""
if [ "$DB_ONLY" = 0 ]; then
  mkdir -p "$WORK/data/config"
  for f in .env backup.env compose.override.yml Caddyfile; do
    if [ -f "$f" ]; then cp -p "$f" "$WORK/data/config/$f"; FILES="$FILES $f"; fi
  done
fi
{
  echo "format=1"
  echo "kind=$KIND"
  echo "created=$STARTED"
  echo "host=$(hostname)"
  echo "dir=$DIR"
  echo "app_version=$VERSION"
  echo "install_mode=$(env_get TASKSPIPES_INSTALL)"
  echo "postgres_version=$PG_VERSION"
  echo "config=${FILES# }"
} > "$WORK/data/manifest"
(cd "$WORK/data" && find . -type f -print0 | sort -z | xargs -0 sha256sum > "$WORK/sums") && mv "$WORK/sums" "$WORK/data/SHA256SUMS"

ARCHIVE="$OUT/$NAME.tar.gz"
tar -czf "$WORK/archive.tar.gz" -C "$WORK/data" . || fail "Could not write the archive."
if [ "$ENCRYPTED" = true ]; then
  need_gpg
  encrypt "$WORK/archive.tar.gz" "$WORK/archive.tar.gz.gpg" || fail "Encryption failed."
  ARCHIVE="$ARCHIVE.gpg"
  mv -f "$WORK/archive.tar.gz.gpg" "$ARCHIVE"
else
  mv -f "$WORK/archive.tar.gz" "$ARCHIVE"
fi
chmod 600 "$ARCHIVE"
SIZE="$(stat -c %s "$ARCHIVE")"
FILE="$(basename "$ARCHIVE")"
printf '%s\n' "$ARCHIVE" > "$OUT/.last"
say "Backup written: $ARCHIVE ($SIZE bytes$([ "$ENCRYPTED" = true ] && echo ', encrypted'))"
[ "$ENCRYPTED" = true ] || [ "$DB_ONLY" = 1 ] || warn "Not encrypted: it holds .env and its secrets. Keep it private (taskspipes-backup --setup to encrypt)."

# Only the latest are kept, of each kind (here only; the storage has its own count).
case "$KIND" in backup) keep="$KEEP" ;; before-restore) keep=3 ;; *) keep=5 ;; esac
if [ -z "$OUTPUT" ]; then
  # shellcheck disable=SC2012 # names without spaces, made above
  { ls -1t "$OUT"/taskspipes-"$KIND"-*.tar.gz "$OUT"/taskspipes-"$KIND"-*.tar.gz.gpg 2>/dev/null || true; } | tail -n +"$((keep + 1))" | xargs -r rm -f
fi

# The off-site copy: planned and manual backups, encrypted only.
REMOTE="" REMOTE_OK="" ERROR=""
if [ "$KIND" = backup ] && [ "$UPLOAD" = 1 ] && s3_on; then
  REMOTE="$(s3_where)"
  if [ "$ENCRYPTED" != true ]; then
    REMOTE_OK=false ERROR="Not copied to $REMOTE: copies sent off the server must be encrypted (set a passphrase with taskspipes-backup --setup)."
    warn "$ERROR"
  else
    say "Copying it to $REMOTE"
    if rclone "$OUT" copyto "/data/$FILE" "$(remote_path)/$FILE" 2> "$WORK/err"; then
      REMOTE_OK=true
      mapfile -t old < <(remote_list | head -n -"$S3_KEEP")
      for f in "${old[@]}"; do
        [ -n "$f" ] || continue
        rclone "$OUT" deletefile "$(remote_path)/$f" >/dev/null 2>&1 || warn "Could not delete $f there."
      done
      say "Copied."
    else
      REMOTE_OK=false ERROR="Copy to $REMOTE failed: $(tail -n 3 "$WORK/err" | tr '\n' ' ')"
      warn "$ERROR"
    fi
  fi
fi
record_run true "$FILE" "$SIZE" "$ENCRYPTED" "$REMOTE" "$REMOTE_OK" "$ERROR" "$STARTED" "$VERSION"
# The backup is here, but not off the server: a distinct status for the timer's log.
[ "$REMOTE_OK" != false ] || exit 2
exit 0
