#!/usr/bin/env bash
# Installs TasksPipes on a Linux server, in one command:
#
#   curl -fsSL https://raw.githubusercontent.com/j33f/TasksPipes/main/scripts/install.sh | sudo bash
#
# It installs Docker from Docker's official repositories when it is missing, asks a few questions (or takes them as
# options), writes the configuration with fresh secrets, puts HTTPS in front with Caddy if you wish, and starts the
# stack. Updates: in one click from the app when the published image exists for this machine (the updater), and in
# one command anyway (the `taskspipes-update` alias, for bash and zsh). Running it again keeps the configuration.
#
# An existing installation — made by hand from a clone of the repository (any version), or by this script — is
# taken over in place: its .env, data and files of its own are kept, the database is backed up first, and it moves to
# the latest release, on the published image with one-click updates when possible. Run it from that directory, or
# give it with --dir.
#
# A new server can also start from a backup of another one (scripts/backup.sh): --restore puts back its data and its
# configuration (secrets included), from a file or from S3-compatible storage. scripts/transfer.sh does it all over SSH.
#
# Options (all optional; asked when missing, unless --yes):
#   --dir DIR             where to install, or the existing installation (default /opt/taskspipes)
#   --domain NAME         public address, e.g. tasks.example.com (or a full URL)
#   --admin-email ADDR    administrator(s) of the instance, comma-separated
#   --outline-url URL     your Outline server (optional)
#   --proxy caddy|none    caddy: HTTPS with an automatic certificate (ports 80, 443); none: your own reverse proxy
#   --port N              port of the app on 127.0.0.1, for your own reverse proxy (default 3000; kept when set)
#   --updates auto|alias  auto: one-click updates from the app (when possible) + the alias; alias: the alias only
#   --version X           version to install (default the latest release)
#   --ref REF             build from this branch or tag of the sources instead of using the published image
#   --backups none|daily|weekly   automatic backups (then asked: how many to keep, encryption, S3-compatible copy)
#   --restore FILE|s3:NAME|s3:latest   start from this backup (its data and configuration) instead of a new instance
#   --passphrase-file F   the passphrase of an encrypted backup to restore
#   --backup-env F        S3 settings and passphrase of the backups to restore (a copy of the old backup.env)
#   --yes                 no questions: defaults and options only
set -euo pipefail

REPO="j33f/TasksPipes"
# Where the release's files come from (TASKSPIPES_RAW: a mirror of the repository's raw files, e.g. for tests).
RAW="${TASKSPIPES_RAW:-https://raw.githubusercontent.com/$REPO}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
trap 'die "Failed at line $LINENO."' ERR

DIR=""
DOMAIN="" ADMIN="" OUTLINE="" PROXY="" PORT="" UPDATES="" TP_VERSION="" REF="" YES=0
BACKUPS="" RESTORE="" PASS_FILE="" BACKUP_ENV=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift ;;
    --domain) DOMAIN="$2"; shift ;;
    --admin-email) ADMIN="$2"; shift ;;
    --outline-url) OUTLINE="$2"; shift ;;
    --proxy) PROXY="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --updates) UPDATES="$2"; shift ;;
    --version) TP_VERSION="${2#v}"; shift ;;
    --ref) REF="$2"; shift ;;
    --backups) BACKUPS="$2"; shift ;;
    --restore) RESTORE="$2"; shift ;;
    --passphrase-file) PASS_FILE="$2"; shift ;;
    --backup-env) BACKUP_ENV="$2"; shift ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,33p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

case "$BACKUPS" in ""|none|daily|weekly) ;; *) die "--backups is none, daily or weekly" ;; esac
# Files given relative to where the installer runs.
abs() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
case "$RESTORE" in
  "") ;;
  s3:*) ;;
  *) [ -f "$RESTORE" ] || die "No such backup: $RESTORE"; RESTORE="$(abs "$RESTORE")" ;;
esac
[ -z "$PASS_FILE" ] || { [ -r "$PASS_FILE" ] || die "Cannot read $PASS_FILE"; PASS_FILE="$(abs "$PASS_FILE")"; }
[ -z "$BACKUP_ENV" ] || { [ -r "$BACKUP_ENV" ] || die "Cannot read $BACKUP_ENV"; BACKUP_ENV="$(abs "$BACKUP_ENV")"; }

# Questions are read from the terminal, also when the script itself comes through a pipe (curl … | bash).
TTY=""
if [ "$YES" = 0 ] && { exec 3</dev/tty; } 2>/dev/null; then TTY=1; fi
ask() { # ask VAR "Question" "default"
  local answer=""
  if [ -n "$TTY" ]; then
    read -r -u 3 -p "$(printf '\033[1m?\033[0m %s%s: ' "$2" "${3:+ [$3]}")" answer || true
  fi
  printf -v "$1" '%s' "${answer:-$3}"
}

# ---- The machine ---------------------------------------------------------------------------------------------------------
[ "$(uname -s)" = Linux ] || die "This script installs TasksPipes on Linux."
[ "$(id -u)" = 0 ] || die "Run it as root: curl -fsSL $RAW/main/scripts/install.sh | sudo bash"
for tool in curl sed grep awk; do command -v "$tool" >/dev/null || die "$tool is needed."; done
[ -r /etc/os-release ] || die "Unknown Linux distribution (no /etc/os-release)."
# shellcheck source=/dev/null
. /etc/os-release
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) PLATFORM=amd64 ;;
  aarch64|arm64) PLATFORM=arm64 ;;
  *) PLATFORM="" ;;
esac

install_docker() {
  say "Installing Docker from Docker's official repositories"
  local family="${ID:-}"
  case "$family" in
    debian|ubuntu|raspbian)
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl >/dev/null
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/$family/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$family ${VERSION_CODENAME:-$UBUNTU_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
      ;;
    fedora|centos|rhel|rocky|almalinux)
      local repo="$family"
      case "$family" in rocky|almalinux) repo=centos ;; esac
      if command -v dnf >/dev/null; then
        dnf -q -y install dnf-plugins-core >/dev/null
        if grep -q addrepo <<<"$(dnf config-manager --help 2>/dev/null)"; then
          dnf config-manager addrepo --overwrite --from-repofile="https://download.docker.com/linux/$repo/docker-ce.repo"
        else
          dnf config-manager --add-repo "https://download.docker.com/linux/$repo/docker-ce.repo"
        fi
        dnf -q -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
      else
        yum -q -y install yum-utils >/dev/null
        yum-config-manager --add-repo "https://download.docker.com/linux/$repo/docker-ce.repo"
        yum -q -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
      fi
      ;;
    *) die "Installing Docker on $PRETTY_NAME is not handled here: install Docker Engine and its Compose plugin (https://docs.docker.com/engine/install/), then run this again." ;;
  esac
  if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then systemctl enable --now docker >/dev/null; fi
}

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install_docker
fi
docker info >/dev/null 2>&1 || die "Docker is installed but not running: start it (systemctl start docker) and run this again."
say "Docker $(docker version -f '{{.Server.Version}}') with Compose $(docker compose version --short)"

# git in the installation's clone, as the person who owns it (its files stay theirs); as root, for this directory only.
git_in() {
  local owner
  owner="$(stat -c %U "$DIR/.git" 2>/dev/null || echo root)"
  if [ "$owner" != root ] && [ "$(id -u)" = 0 ] && command -v runuser >/dev/null; then
    runuser -u "$owner" -- git -C "$DIR" -c advice.detachedHead=false "$@"
  else
    git -C "$DIR" -c safe.directory="$DIR" -c advice.detachedHead=false "$@"
  fi
}

# ---- Where ----------------------------------------------------------------------------------------------------------------
# An installation of TasksPipes: a .env next to a compose file that runs it.
is_install() { [ -f "$1/.env" ] && grep -qs -i "taskspipes" "$1/docker-compose.yml" "$1/compose.yml"; }
if [ -z "$DIR" ]; then
  DIR=/opt/taskspipes
  if [ "$PWD" != "$DIR" ] && ! is_install "$DIR" && is_install "$PWD"; then
    if [ -n "$TTY" ]; then
      ask HERE "An installation of TasksPipes is in $PWD: take it over (yes) or install anew in $DIR (no)" "yes"
      case "$HERE" in y|Y|yes|YES|o|oui) DIR="$PWD" ;; esac
    else
      die "An installation of TasksPipes is in $PWD: give --dir $PWD to take it over, or --dir $DIR to install anew."
    fi
  fi
fi
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"
EXISTING=0
if is_install "$DIR"; then EXISTING=1; fi

# A clone of the repository must hold no change of its own: moving it to the release's tag would fail or lose them.
if [ "$EXISTING" = 1 ] && [ -d "$DIR/.git" ]; then
  command -v git >/dev/null || die "$DIR is a clone of the repository, but git is missing."
  changes="$(git_in status --porcelain --untracked-files=no)"
  [ -z "$changes" ] || die "$DIR holds changes to the repository's files ($(echo "$changes" | awk '{print $2}' | tr '\n' ' ')): commit, stash or undo them, then run this again."
fi

# ---- Which version, and how ----------------------------------------------------------------------------------------------
latest_release() {
  curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1
}
if [ -z "$REF" ] && [ -z "$TP_VERSION" ]; then
  TP_VERSION="$(latest_release || true)"
  [ -n "$TP_VERSION" ] || die "Could not learn the latest release from GitHub; give one with --version."
fi
# The published image when it exists for this machine (or is already here); the sources otherwise (or when --ref asks
# for them).
MODE=source
if [ -z "$REF" ] && [ -n "$PLATFORM" ] && { grep -q "\"architecture\": *\"$PLATFORM\"" <<<"$(docker manifest inspect "ghcr.io/j33f/taskspipes:$TP_VERSION" 2>/dev/null)" \
  || docker image inspect "ghcr.io/j33f/taskspipes:$TP_VERSION" >/dev/null 2>&1; }; then
  MODE=image
fi
# Images pulled; those that cannot be are fine when they are already here.
pull_images() {
  docker compose pull --quiet 2>/dev/null && return 0
  local image
  for image in $(docker compose config --images); do
    docker image inspect "$image" >/dev/null 2>&1 || die "Could not download $image."
  done
}
[ -n "$REF" ] || REF="v$TP_VERSION"
if [ "$MODE" = source ]; then
  command -v git >/dev/null || case "${ID:-}" in
    debian|ubuntu|raspbian) DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null ;;
    *) (dnf -q -y install git || yum -q -y install git) >/dev/null ;;
  esac
  say "TasksPipes ${TP_VERSION:-$REF}: built from the sources on this machine ($ARCH)"
else
  say "TasksPipes $TP_VERSION: published image for $PLATFORM"
fi

# ---- An existing installation: its data first -------------------------------------------------------------------------------
cd "$DIR"
OLD_BIND=""
if [ "$EXISTING" = 1 ]; then
  say "Taking over the installation in $DIR (its configuration and data are kept)"
  # Before 0.8.0 the app was published on every address: kept as it was, so that a proxy elsewhere still reaches it.
  OLD_BIND="$(docker compose port app 3000 2>/dev/null | sed 's/:[0-9]*$//' | head -n 1 || true)"
  if [ -n "$(docker compose ps -q db 2>/dev/null)" ]; then
    mkdir -p backups
    chmod 700 backups
    backup="backups/taskspipes-before-install-$(date +%Y%m%d-%H%M%S).sql.gz"
    if docker compose exec -T db pg_dump -U taskspipes taskspipes | gzip > "$backup"; then
      say "Database backed up to $DIR/$backup"
    else
      rm -f "$backup"
      die "The database could not be backed up: nothing changed."
    fi
  else
    warn "The database is not running: no backup made."
  fi
fi

# ---- Files -----------------------------------------------------------------------------------------------------------------
if [ -d .git ]; then
  # A clone of the repository (made by hand, or by this script): moved to the release, whatever the mode.
  git_in fetch --quiet --tags origin
  git_in checkout --quiet "$REF"
elif [ "$MODE" = source ]; then
  [ -z "$(find . -mindepth 1 -maxdepth 1 ! -name .env ! -name backups -print -quit)" ] \
    || die "$DIR holds files but no clone of the repository: building from the sources needs an empty directory."
  git clone --quiet "https://github.com/$REPO.git" .tmp-clone && cp -a .tmp-clone/. . && rm -rf .tmp-clone
  git_in checkout --quiet "$REF"
else
  # The release's compose file; one changed by hand is kept aside.
  if [ -f docker-compose.yml ] && ! grep -q "TASKSPIPES_VERSION" docker-compose.yml; then
    cp docker-compose.yml "docker-compose.yml.before-install"
    warn "Your docker-compose.yml is kept as docker-compose.yml.before-install; put your own changes in compose.override.yml."
  fi
  curl -fsSL "$RAW/$REF/docker-compose.yml" -o docker-compose.yml
  curl -fsSL "$RAW/$REF/.env.example" -o .env.example
  mkdir -p scripts
  for f in update.sh backup.sh restore.sh transfer.sh install.sh; do
    # Replaced, not rewritten: a copy of this very script may be running.
    if curl -fsSL "$RAW/$REF/scripts/$f" -o "scripts/$f.new"; then mv -f "scripts/$f.new" "scripts/$f"; else rm -f "scripts/$f.new"; fi
  done
fi
for f in update.sh backup.sh restore.sh transfer.sh; do
  [ -f "scripts/$f" ] || curl -fsSL "$RAW/main/scripts/$f" -o "scripts/$f"
  chmod +x "scripts/$f"
done
grep -q "TASKSPIPES_VERSION" docker-compose.yml || die "TasksPipes $REF is too old for this installer (0.18.0 or later)."

# ---- From a backup: its configuration first ------------------------------------------------------------------------------------
RESTORE_FILE=""
TMP_PASS=""
if [ -n "$RESTORE" ]; then
  mkdir -p backups
  chmod 700 backups
  # A copy of the backup stays in backups/ (the file given may be temporary).
  if [ -f "$RESTORE" ] && [ "$(dirname "$RESTORE")" != "$DIR/backups" ]; then
    cp "$RESTORE" "backups/$(basename "$RESTORE")"
    chmod 600 "backups/$(basename "$RESTORE")"
    RESTORE="$DIR/backups/$(basename "$RESTORE")"
  fi
  # The passphrase, asked once for both steps.
  case "$RESTORE" in
    *.gpg|s3:*)
      if [ -z "$PASS_FILE" ] && [ -n "$TTY" ] && ! grep -qs '^BACKUP_PASSPHRASE=.' "${BACKUP_ENV:-/nonexistent}"; then
        read -r -s -u 3 -p "$(printf '\033[1m?\033[0m Passphrase of the backup: ')" pass || true
        echo
        TMP_PASS="$(mktemp)"
        chmod 600 "$TMP_PASS"
        printf '%s\n' "$pass" > "$TMP_PASS"
        PASS_FILE="$TMP_PASS"
      fi ;;
  esac
  trap '[ -z "$TMP_PASS" ] || rm -f "$TMP_PASS"' EXIT
  restore_args=()
  [ -z "$PASS_FILE" ] || restore_args+=(--passphrase-file "$PASS_FILE")
  [ -z "$BACKUP_ENV" ] || restore_args+=(--backup-env "$BACKUP_ENV")
  say "Reading the backup $RESTORE"
  fetched="$(mktemp)"
  TP_DIR="$DIR" scripts/restore.sh --extract-config --fetched-to "$fetched" ${DOMAIN:+--domain "$DOMAIN"} "${restore_args[@]}" "$RESTORE" \
    || die "The backup could not be read: nothing was started."
  RESTORE_FILE="$(cat "$fetched")"
  rm -f "$fetched"
fi

# ---- Configuration ---------------------------------------------------------------------------------------------------------
secret() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
env_get() {
  if [ -f .env ]; then sed -n "s/^$1=//p" .env | tail -n 1; fi
}
env_set() {
  if grep -q "^$1=" .env 2>/dev/null; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}

FIRST=1
[ -f .env ] && FIRST=0
if [ "$FIRST" = 1 ]; then
  [ -z "$TTY" ] || say "A few questions (Enter keeps the suggestion)"
  [ -n "$DOMAIN" ] || ask DOMAIN "Public address of TasksPipes (e.g. tasks.example.com)" "$(hostname -f 2>/dev/null || hostname)"
  [ -n "$ADMIN" ] || ask ADMIN "E-mail address of the administrator (comma-separated for several)" ""
  [ -n "$OUTLINE" ] || ask OUTLINE "Your Outline server, if any (e.g. https://docs.example.com; empty: none)" ""
  if [ -z "$PROXY" ]; then
    ask PROXY "HTTPS: 'caddy' (automatic certificate, needs ports 80 and 443) or 'none' (your own reverse proxy)" "caddy"
  fi
  if [ -z "$UPDATES" ]; then
    ask UPDATES "Updates: 'auto' (one click from the app, and a command) or 'alias' (a command only)" "auto"
  fi
  if [ -z "$BACKUPS" ]; then
    ask BACKUPS "Automatic backups: 'none', 'daily' or 'weekly' (then: how many to keep, encryption, S3 copy)" "none"
  fi
  case "$BACKUPS" in none|daily|weekly) ;; *) die "Automatic backups: none, daily or weekly" ;; esac
else
  say "Keeping the configuration of $DIR/.env"
  PROXY="${PROXY:-$(grep -qs "Written by scripts/install.sh" compose.override.yml && echo caddy || echo none)}"
  # Taking over an installation made by hand: one-click updates unless asked otherwise.
  UPDATES="${UPDATES:-$(grep -q '^TASKSPIPES_INSTALL=' .env && ! grep -q '^COMPOSE_PROFILES=.*updater' .env && echo alias || echo auto)}"
fi
case "$PROXY" in caddy|none) ;; *) die "--proxy is caddy or none" ;; esac
case "$UPDATES" in auto|alias) ;; *) die "--updates is auto or alias" ;; esac
[ -z "$PORT" ] || [[ "$PORT" =~ ^[0-9]+$ ]] || die "--port is a number"

if [ "$FIRST" = 1 ]; then
  DOMAIN="${DOMAIN#http://}" DOMAIN="${DOMAIN#https://}" DOMAIN="${DOMAIN%%/*}"
  [ -n "$DOMAIN" ] || die "The public address is needed (--domain)."
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "Invalid address: $DOMAIN"
  [ -z "$OUTLINE" ] || [[ "$OUTLINE" =~ ^https?://[^[:space:]]+$ ]] || die "Invalid Outline address: $OUTLINE"
  [ -z "$ADMIN" ] || [[ "$ADMIN" =~ ^[^[:space:]@,]+@[^[:space:]@,]+(,[^[:space:]@,]+@[^[:space:]@,]+)*$ ]] || die "Invalid e-mail address: $ADMIN"
  umask 077
  {
    echo "# Written by scripts/install.sh on $(date -u +%Y-%m-%d). Everything else (e-mail, Outline, sign-in) can be set"
    echo "# in TasksPipes, Administration › Settings; see .env.example and docs/HOSTING.md for every variable."
    echo "APP_URL=https://$DOMAIN"
    echo "APP_SECRET=$(secret)"
    echo "POSTGRES_PASSWORD=$(secret)"
    echo "ADMIN_EMAILS=$ADMIN"
    [ -z "$OUTLINE" ] || echo "OUTLINE_URL=${OUTLINE%/}"
  } > .env
  umask 022
fi
chmod 600 .env
if [ "$MODE" = image ]; then env_set TASKSPIPES_VERSION "$TP_VERSION"; fi
# How this installation updates (read by scripts/update.sh).
env_set TASKSPIPES_INSTALL "$MODE"

# HTTPS: Caddy in front (automatic certificate), or the app on 127.0.0.1 for a reverse proxy of one's own. The address
# and port already set are kept.
if [ -z "$(env_get APP_BIND)" ]; then
  case "$OLD_BIND" in
    ""|127.0.0.1|localhost) env_set APP_BIND 127.0.0.1 ;;
    *)
      env_set APP_BIND 0.0.0.0
      warn "The app was reachable on every address of this machine: kept (APP_BIND=0.0.0.0). If your reverse proxy runs here, set APP_BIND=127.0.0.1 in .env (see docs/HOSTING.md)."
      ;;
  esac
fi
if [ -n "$PORT" ]; then env_set APP_PORT "$PORT"; elif [ -z "$(env_get APP_PORT)" ]; then env_set APP_PORT 3000; fi
PORT="$(env_get APP_PORT)"
if [ "$PROXY" = caddy ]; then
  if [ -f compose.override.yml ] && ! grep -q "Written by scripts/install.sh" compose.override.yml; then
    die "compose.override.yml is yours: Caddy cannot be added to it. Use --proxy none, or merge it by hand."
  fi
  host="$(sed -n 's|^APP_URL=https\{0,1\}://||p' .env | tail -n 1)"
  cat > Caddyfile <<EOF
# Written by scripts/install.sh: HTTPS for TasksPipes, certificate obtained and renewed by Caddy.
$host {
	encode zstd gzip
	reverse_proxy app:3000
}
EOF
  cat > compose.override.yml <<'EOF'
# Written by scripts/install.sh: Caddy in front of TasksPipes (HTTPS, automatic certificate).
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - app

volumes:
  caddy-data:
  caddy-config:
EOF
else
  # Only what this script wrote: a compose.override.yml or Caddyfile of one's own stays.
  for f in compose.override.yml Caddyfile; do
    if grep -qs "Written by scripts/install.sh" "$f"; then rm -f "$f"; fi
  done
fi

# Updates in one click: the updater service, which needs the published images.
# Other Compose profiles set in .env are kept.
profiles="$(env_get COMPOSE_PROFILES | tr ',' '\n' | grep -v -x -e updater -e '' | paste -sd, - || true)"
if [ "$UPDATES" = auto ] && [ "$MODE" = image ]; then
  [ -n "$(env_get UPDATER_TOKEN)" ] || env_set UPDATER_TOKEN "$(secret)"
  env_set PROJECT_DIR "$DIR"
  env_set COMPOSE_PROFILES "${profiles:+$profiles,}updater"
else
  if [ "$UPDATES" = auto ]; then warn "One-click updates need the published image: this instance updates with taskspipes-update."; fi
  sed -i '/^UPDATER_TOKEN=/d' .env
  if [ -n "$profiles" ]; then env_set COMPOSE_PROFILES "$profiles"; else sed -i '/^COMPOSE_PROFILES=/d' .env; fi
fi

# ---- Start ------------------------------------------------------------------------------------------------------------------
if [ -n "$RESTORE_FILE" ]; then
  # The data of the backup, then the whole stack (restore.sh starts it and waits until it is healthy).
  if [ "$MODE" = image ]; then pull_images; fi
  say "Restoring the data of the backup"
  TP_DIR="$DIR" scripts/restore.sh --yes --keep-config --no-safety-backup ${DOMAIN:+--domain "$DOMAIN"} "${restore_args[@]}" "$RESTORE_FILE" \
    || die "The restore failed (see above). The backup is in $RESTORE_FILE; the configuration it held is in $DIR."
fi
say "Starting TasksPipes (the first start can take a few minutes)"
if [ "$MODE" = image ]; then
  pull_images
  docker compose up -d --no-build --remove-orphans
else
  docker compose up -d --build --remove-orphans
fi
id="$(docker compose ps -q app)"
for _ in $(seq 1 90); do
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
  [ "$state" = healthy ] && break
  [ "$state" = unhealthy ] && break
  sleep 2
done
[ "$state" = healthy ] || die "TasksPipes did not start ($state): see docker compose -f $DIR/docker-compose.yml logs app"

# ---- Backups -------------------------------------------------------------------------------------------------------------------
if [ -n "$RESTORE_FILE" ]; then
  : # restore.sh set up the backups of the backup's backup.env.
elif [ -n "$BACKUPS" ] && { [ "$BACKUPS" != none ] || [ -f backup.env ]; }; then
  setup=(--setup --schedule "$BACKUPS")
  if [ -z "$TTY" ]; then
    setup+=(--yes)
    grep -qs '^BACKUP_PASSPHRASE=.' backup.env || setup+=(--generate-passphrase)
  fi
  TP_DIR="$DIR" scripts/backup.sh "${setup[@]}" || warn "Backups could not be set up: run taskspipes-backup --setup."
fi

# ---- The commands -------------------------------------------------------------------------------------------------------------
# For root, and for the person who ran sudo, in bash and zsh: taskspipes-update, -backup, -restore and -transfer.
add_alias() { # add_alias HOME
  local rc cmd
  for rc in "$1/.bashrc" "$1/.zshrc"; do
    case "$rc" in *zshrc) command -v zsh >/dev/null || [ -f "$rc" ] || continue ;; esac
    touch "$rc"
    sed -i '/# TasksPipes update command/d;/# TasksPipes command/d;/alias taskspipes-update=/d' "$rc"
    for cmd in update backup restore transfer; do
      printf "alias taskspipes-%s='sudo %s/scripts/%s.sh' # TasksPipes command\n" "$cmd" "$DIR" "$cmd" >> "$rc"
    done
    if [ -n "${SUDO_USER:-}" ] && [ "$1" != /root ]; then chown "$SUDO_USER": "$rc"; fi
  done
  return 0
}
add_alias /root
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
  add_alias "$(getent passwd "$SUDO_USER" | cut -d: -f6)"
fi

url="$(sed -n 's/^APP_URL=//p' .env | tail -n 1)"
echo
say "TasksPipes is running."
cat <<EOF

  Address:        $url$( [ "$PROXY" = none ] && printf '\n                  (the app listens on 127.0.0.1:%s: point your reverse proxy there)' "$PORT")
  Installed in:   $DIR   (configuration: .env, kept secret)
  Administrator:  ${ADMIN:-$(sed -n 's/^ADMIN_EMAILS=//p' .env)}   — e-mail, Outline and sign-in are set in Administration › Settings
  Updates:        $( [ "$UPDATES" = auto ] && [ "$MODE" = image ] && echo "in one click from the app (About), or with taskspipes-update" || echo "taskspipes-update")
                  (open a new terminal for the commands; taskspipes-update --check only checks)
  Backups:        $(sed -n 's/^BACKUP_SCHEDULE=//p' backup.env 2>/dev/null | grep -v '^none$' || echo "by hand"): taskspipes-backup (--setup to plan them, --status), taskspipes-restore
  Other server:   taskspipes-transfer user@new-server moves this instance there
  Logs:           docker compose -f $DIR/docker-compose.yml logs -f app

EOF
