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
# Options (all optional; asked when missing, unless --yes):
#   --dir DIR             where to install (default /opt/taskspipes)
#   --domain NAME         public address, e.g. tasks.example.com (or a full URL)
#   --admin-email ADDR    administrator(s) of the instance, comma-separated
#   --outline-url URL     your Outline server (optional)
#   --proxy caddy|none    caddy: HTTPS with an automatic certificate (ports 80, 443); none: your own reverse proxy
#   --port N              port of the app on 127.0.0.1, for your own reverse proxy (default 3000)
#   --updates auto|alias  auto: one-click updates from the app (when possible) + the alias; alias: the alias only
#   --version X           version to install (default the latest release)
#   --ref REF             build from this branch or tag of the sources instead of using the published image
#   --yes                 no questions: defaults and options only
set -euo pipefail

REPO="j33f/TasksPipes"
RAW="https://raw.githubusercontent.com/$REPO"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
trap 'die "Failed at line $LINENO."' ERR

DIR="/opt/taskspipes"
DOMAIN="" ADMIN="" OUTLINE="" PROXY="" PORT="3000" UPDATES="" TP_VERSION="" REF="" YES=0
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
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,24p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

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
        if dnf config-manager --help 2>/dev/null | grep -q addrepo; then
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

# ---- Which version, and how ----------------------------------------------------------------------------------------------
latest_release() {
  curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1
}
if [ -z "$REF" ] && [ -z "$TP_VERSION" ]; then
  TP_VERSION="$(latest_release || true)"
  [ -n "$TP_VERSION" ] || die "Could not learn the latest release from GitHub; give one with --version."
fi
# The published image when it exists for this machine; the sources otherwise (or when --ref asks for them).
MODE=source
if [ -z "$REF" ] && [ -n "$PLATFORM" ] && docker manifest inspect "ghcr.io/j33f/taskspipes:$TP_VERSION" 2>/dev/null | grep -q "\"architecture\": *\"$PLATFORM\""; then
  MODE=image
fi
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

# ---- Files -----------------------------------------------------------------------------------------------------------------
mkdir -p "$DIR"
cd "$DIR"
if [ "$MODE" = source ]; then
  if [ -d .git ]; then
    git fetch --quiet --tags origin
  elif [ -z "$(find . -mindepth 1 -maxdepth 1 ! -name .env ! -name backups -print -quit)" ]; then
    git clone --quiet "https://github.com/$REPO.git" .tmp-clone && cp -a .tmp-clone/. . && rm -rf .tmp-clone
  else
    die "$DIR already holds an installation from the published image: update it with taskspipes-update."
  fi
  git -c advice.detachedHead=false checkout --quiet "$REF"
else
  [ -d .git ] && die "$DIR holds an installation built from the sources: update it with taskspipes-update."
  curl -fsSL "$RAW/$REF/docker-compose.yml" -o docker-compose.yml
  curl -fsSL "$RAW/$REF/.env.example" -o .env.example
  mkdir -p scripts
  curl -fsSL "$RAW/$REF/scripts/update.sh" -o scripts/update.sh
fi
[ -f scripts/update.sh ] || curl -fsSL "$RAW/main/scripts/update.sh" -o scripts/update.sh
chmod +x scripts/update.sh
grep -q "TASKSPIPES_VERSION" docker-compose.yml || die "TasksPipes $REF is too old for this installer (0.18.0 or later)."

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
else
  say "Keeping the configuration of $DIR/.env"
  PROXY="${PROXY:-$([ -f compose.override.yml ] && grep -q caddy compose.override.yml && echo caddy || echo none)}"
  UPDATES="${UPDATES:-$(grep -q '^COMPOSE_PROFILES=.*updater' .env && echo auto || echo alias)}"
fi
case "$PROXY" in caddy|none) ;; *) die "--proxy is caddy or none" ;; esac
case "$UPDATES" in auto|alias) ;; *) die "--updates is auto or alias" ;; esac
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port is a number"

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

# HTTPS: Caddy in front (automatic certificate), or the app on 127.0.0.1 for a reverse proxy of one's own.
env_set APP_BIND 127.0.0.1
env_set APP_PORT "$PORT"
if [ "$PROXY" = caddy ]; then
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
  rm -f compose.override.yml Caddyfile
fi

# Updates in one click: the updater service, which needs the published images.
if [ "$UPDATES" = auto ] && [ "$MODE" = image ]; then
  [ -n "$(env_get UPDATER_TOKEN)" ] || env_set UPDATER_TOKEN "$(secret)"
  env_set PROJECT_DIR "$DIR"
  env_set COMPOSE_PROFILES updater
else
  if [ "$UPDATES" = auto ]; then warn "One-click updates need the published image: this instance updates with taskspipes-update."; fi
  sed -i '/^COMPOSE_PROFILES=/d;/^UPDATER_TOKEN=/d' .env
fi

# ---- Start ------------------------------------------------------------------------------------------------------------------
say "Starting TasksPipes (the first start can take a few minutes)"
if [ "$MODE" = image ]; then
  docker compose pull --quiet
  docker compose up -d --remove-orphans
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

# ---- The update command -------------------------------------------------------------------------------------------------------
# For root, and for the person who ran sudo: `taskspipes-update` in bash and zsh.
alias_line="alias taskspipes-update='sudo $DIR/scripts/update.sh'"
add_alias() { # add_alias HOME
  local rc
  for rc in "$1/.bashrc" "$1/.zshrc"; do
    case "$rc" in *zshrc) command -v zsh >/dev/null || [ -f "$rc" ] || continue ;; esac
    touch "$rc"
    sed -i '/# TasksPipes update command/d;/alias taskspipes-update=/d' "$rc"
    printf '%s # TasksPipes update command\n' "$alias_line" >> "$rc"
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
                  (open a new terminal for the alias; taskspipes-update --check only checks)
  Logs:           docker compose -f $DIR/docker-compose.yml logs -f app

EOF
