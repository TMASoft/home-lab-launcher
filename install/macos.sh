#!/bin/sh
set -eu

INSTALLER_OS="macOS"
DOCKER_INSTALL_URL="https://docs.docker.com/desktop/setup/install/mac-install/"
DEFAULT_INSTALL_DIR="$HOME/home-lab-launcher"
DEFAULT_IMAGE_TAG="v0.9.5"
IMAGE_REPOSITORY="ghcr.io/tmasoft/home-lab-launcher"

TTY_PATH="/dev/tty"

if [ ! -r "$TTY_PATH" ]; then
  printf '%s\n' "This installer is interactive and needs a terminal."
  printf '%s\n' "Download it first, then run: sh macos.sh"
  exit 1
fi

say() {
  printf '%s\n' "$*" > "$TTY_PATH"
}

prompt() {
  question=$1
  default=$2
  printf '%s' "$question" > "$TTY_PATH"
  if [ -n "$default" ]; then
    printf ' [%s]' "$default" > "$TTY_PATH"
  fi
  printf ': ' > "$TTY_PATH"
  IFS= read -r answer < "$TTY_PATH" || answer=""
  if [ -z "$answer" ]; then
    answer=$default
  fi
  printf '%s' "$answer"
}

prompt_required() {
  question=$1
  default=$2
  while :; do
    answer=$(prompt "$question" "$default")
    if [ -n "$answer" ]; then
      printf '%s' "$answer"
      return 0
    fi
    say "A value is required."
  done
}

prompt_yes_no() {
  question=$1
  default=$2
  while :; do
    answer=$(prompt "$question" "$default")
    case "$answer" in
      y|Y|yes|YES|Yes) printf 'yes'; return 0 ;;
      n|N|no|NO|No) printf 'no'; return 0 ;;
      *) say "Enter yes or no." ;;
    esac
  done
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    say "Docker is not installed."
    say "Install Docker Desktop for $INSTALLER_OS, then rerun this installer:"
    say "$DOCKER_INSTALL_URL"
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    say "Docker is installed, but Docker Desktop is not running or is not ready."
    say "Start Docker Desktop, verify 'docker info' works, then rerun this installer."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    say "Docker Compose v2 is not available as 'docker compose'."
    say "Install or update Docker Desktop, then rerun this installer:"
    say "$DOCKER_INSTALL_URL"
    exit 1
  fi
}

check_platform() {
  detected_os=$(uname -s 2>/dev/null || echo unknown)
  if [ "$detected_os" != "Darwin" ]; then
    say "Warning: this is the macOS installer, but this system reports '$detected_os'."
    if [ "$detected_os" = "Linux" ]; then
      say "Consider using install/linux.sh instead."
    fi
  fi
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 48
    return 0
  fi

  if [ -r /dev/urandom ]; then
    head -c 48 /dev/urandom | od -An -vtx1 | tr -d ' \n'
    return 0
  fi

  say "Neither OpenSSL nor /dev/urandom is available, so the installer cannot generate SESSION_SECRET automatically."
  prompt_required "Paste a long random SESSION_SECRET" ""
}

write_compose_file() {
  compose_file=$1
  if [ "$include_nginx" = "yes" ]; then
    cat > "$compose_file" <<'COMPOSE'
services:
  launcher:
    image: ${APP_IMAGE:?Set APP_IMAGE in .env before starting}
    container_name: home-lab-launcher
    restart: unless-stopped
    environment:
      PORT: 8080
      HOST: ${HOST:-0.0.0.0}
      TRUST_PROXY: ${TRUST_PROXY:-1}
      SERVER_FETCH_PRIVATE_NETWORK_ACCESS: ${SERVER_FETCH_PRIVATE_NETWORK_ACCESS:-admin-editor}
      APP_NAME: ${APP_NAME:-Home Lab Launcher}
      APP_BASE_URL: ${APP_BASE_URL:-http://localhost:${HOST_PORT:-8080}}
      SESSION_SECRET: ${SESSION_SECRET:?Set SESSION_SECRET in .env before starting}
      BOOTSTRAP_ADMIN_USERNAME: ${BOOTSTRAP_ADMIN_USERNAME:-}
      BOOTSTRAP_ADMIN_PASSWORD: ${BOOTSTRAP_ADMIN_PASSWORD:-}
      PUBLIC_READ_ENABLED: ${PUBLIC_READ_ENABLED:-false}
      LOG_RETENTION_DAYS: ${LOG_RETENTION_DAYS:-90}
      SCHEDULED_BACKUP_LOCATION: ${SCHEDULED_BACKUP_LOCATION:-}
      DATA_DIR: /app/data
      PLUGIN_DIR: /app/data/plugins
      NODE_EXTRA_CA_CERTS: ${NODE_EXTRA_CA_CERTS:-}
      ENABLE_LOCAL_PLUGIN_INSTALL: ${ENABLE_LOCAL_PLUGIN_INSTALL:-false}
      LOCAL_PLUGIN_HOST_DIR: ${LOCAL_PLUGIN_HOST_DIR:-./local-plugins}
      LOCAL_PLUGIN_CONTAINER_DIR: ${LOCAL_PLUGIN_CONTAINER_DIR:-/app/local-plugins}
    expose:
      - "8080"
    volumes:
      - launcher-data:/app/data
      - ${LOCAL_PLUGIN_HOST_DIR:-./local-plugins}:${LOCAL_PLUGIN_CONTAINER_DIR:-/app/local-plugins}:ro
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/api/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  nginx:
    image: nginx:1.27-alpine
    container_name: home-lab-launcher-nginx
    restart: unless-stopped
    depends_on:
      launcher:
        condition: service_healthy
    ports:
      - "${HOST_BIND_IP:-0.0.0.0}:${HOST_PORT:-80}:80"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

volumes:
  launcher-data:
COMPOSE
    return 0
  fi

  cat > "$compose_file" <<'COMPOSE'
services:
  launcher:
    image: ${APP_IMAGE:?Set APP_IMAGE in .env before starting}
    container_name: home-lab-launcher
    restart: unless-stopped
    environment:
      PORT: 8080
      HOST: ${HOST:-0.0.0.0}
      TRUST_PROXY: ${TRUST_PROXY:-false}
      SERVER_FETCH_PRIVATE_NETWORK_ACCESS: ${SERVER_FETCH_PRIVATE_NETWORK_ACCESS:-admin-editor}
      APP_NAME: ${APP_NAME:-Home Lab Launcher}
      APP_BASE_URL: ${APP_BASE_URL:-http://localhost:${HOST_PORT:-8080}}
      SESSION_SECRET: ${SESSION_SECRET:?Set SESSION_SECRET in .env before starting}
      BOOTSTRAP_ADMIN_USERNAME: ${BOOTSTRAP_ADMIN_USERNAME:-}
      BOOTSTRAP_ADMIN_PASSWORD: ${BOOTSTRAP_ADMIN_PASSWORD:-}
      PUBLIC_READ_ENABLED: ${PUBLIC_READ_ENABLED:-false}
      LOG_RETENTION_DAYS: ${LOG_RETENTION_DAYS:-90}
      SCHEDULED_BACKUP_LOCATION: ${SCHEDULED_BACKUP_LOCATION:-}
      DATA_DIR: /app/data
      PLUGIN_DIR: /app/data/plugins
      NODE_EXTRA_CA_CERTS: ${NODE_EXTRA_CA_CERTS:-}
      ENABLE_LOCAL_PLUGIN_INSTALL: ${ENABLE_LOCAL_PLUGIN_INSTALL:-false}
      LOCAL_PLUGIN_HOST_DIR: ${LOCAL_PLUGIN_HOST_DIR:-./local-plugins}
      LOCAL_PLUGIN_CONTAINER_DIR: ${LOCAL_PLUGIN_CONTAINER_DIR:-/app/local-plugins}
    ports:
      - "${HOST_BIND_IP:-0.0.0.0}:${HOST_PORT:-8080}:8080"
    volumes:
      - launcher-data:/app/data
      - ${LOCAL_PLUGIN_HOST_DIR:-./local-plugins}:${LOCAL_PLUGIN_CONTAINER_DIR:-/app/local-plugins}:ro
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/api/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  launcher-data:
COMPOSE
}

write_nginx_file() {
  nginx_file=$1
  cat > "$nginx_file" <<'NGINX'
server {
  listen 80;
  server_name _;

  client_max_body_size 10m;

  location / {
    proxy_pass http://launcher:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
  }
}
NGINX
}

write_env_file() {
  env_file=$1
  cat > "$env_file" <<ENV
# Home Lab Launcher generated config
NODE_ENV=production
APP_IMAGE=$app_image

HOST_BIND_IP=$host_bind_ip
HOST_PORT=$host_port
HOST=0.0.0.0
PORT=8080
TRUST_PROXY=$trust_proxy
SERVER_FETCH_PRIVATE_NETWORK_ACCESS=admin-editor

APP_NAME=Home Lab Launcher
APP_BASE_URL=$app_base_url
SESSION_SECRET=$session_secret
DATA_DIR=/app/data
PLUGIN_DIR=/app/data/plugins
NODE_EXTRA_CA_CERTS=

BOOTSTRAP_ADMIN_USERNAME=$bootstrap_username
BOOTSTRAP_ADMIN_PASSWORD=$bootstrap_password

PUBLIC_READ_ENABLED=$public_read_enabled

LOG_RETENTION_DAYS=90
SCHEDULED_BACKUP_LOCATION=
ENABLE_LOCAL_PLUGIN_INSTALL=false
LOCAL_PLUGIN_HOST_DIR=./local-plugins
LOCAL_PLUGIN_CONTAINER_DIR=/app/local-plugins
ENV
}

say "Home Lab Launcher installer for $INSTALLER_OS"
say "This creates a Docker Compose install using the published GHCR image."

check_platform
check_docker

install_dir=$(prompt_required "Install directory" "$DEFAULT_INSTALL_DIR")
image_tag=$(prompt_required "Image tag" "$DEFAULT_IMAGE_TAG")
app_image="$IMAGE_REPOSITORY:$image_tag"

include_nginx=$(prompt_yes_no "Include a basic bundled Nginx reverse proxy" "no")
if [ "$include_nginx" = "yes" ]; then
  say "Bundled Nginx is HTTP-only. Put a TLS-capable reverse proxy in front before exposing it outside a private LAN."
  host_port=$(prompt_required "Host port for bundled Nginx" "80")
  host_bind_ip="0.0.0.0"
  trust_proxy="1"
  default_base_url="http://localhost:$host_port"
else
  host_port=$(prompt_required "Host port" "8080")
  reverse_proxy=$(prompt_yes_no "Will this run behind an existing same-host reverse proxy" "no")
  if [ "$reverse_proxy" = "yes" ]; then
    host_bind_ip="127.0.0.1"
    trust_proxy="loopback"
    default_base_url="https://launcher.example.test"
  else
    host_bind_ip="0.0.0.0"
    trust_proxy="false"
    default_base_url="http://localhost:$host_port"
  fi
fi

app_base_url=$(prompt_required "Browser-facing APP_BASE_URL" "$default_base_url")

public_read_answer=$(prompt_yes_no "Enable anonymous read-only access" "no")
if [ "$public_read_answer" = "yes" ]; then
  public_read_enabled="true"
else
  public_read_enabled="false"
fi

say "First admin setup is recommended in the browser on first page load."
env_bootstrap=$(prompt_yes_no "Configure first admin with environment variables instead" "no")
if [ "$env_bootstrap" = "yes" ]; then
  bootstrap_username=$(prompt_required "Bootstrap admin username" "admin")
  bootstrap_password=$(prompt_required "Bootstrap admin password" "")
else
  bootstrap_username=""
  bootstrap_password=""
fi

session_secret=$(generate_secret)

compose_file="$install_dir/docker-compose.yml"
env_file="$install_dir/.env"
nginx_dir="$install_dir/nginx"
nginx_file="$nginx_dir/default.conf"

if [ -e "$compose_file" ] || [ -e "$env_file" ] || { [ "$include_nginx" = "yes" ] && [ -e "$nginx_file" ]; }; then
  overwrite=$(prompt_yes_no "Generated install files already exist. Overwrite them" "no")
  if [ "$overwrite" != "yes" ]; then
    say "No files were changed."
    exit 0
  fi
fi

mkdir -p "$install_dir"
mkdir -p "$install_dir/local-plugins"
if [ "$include_nginx" = "yes" ]; then
  mkdir -p "$nginx_dir"
fi
write_compose_file "$compose_file"
: > "$env_file"
chmod 600 "$env_file"
write_env_file "$env_file"
if [ "$include_nginx" = "yes" ]; then
  write_nginx_file "$nginx_file"
fi

say "Generated: $compose_file"
say "Generated: $env_file"
if [ "$include_nginx" = "yes" ]; then
  say "Generated: $nginx_file"
fi

if (cd "$install_dir" && docker compose config >/dev/null); then
  say "Docker Compose configuration is valid."
else
  say "Docker Compose configuration validation failed. Review files in $install_dir."
  exit 1
fi

start_now=$(prompt_yes_no "Start Home Lab Launcher now" "yes")
if [ "$start_now" = "yes" ]; then
  (cd "$install_dir" && docker compose up -d)
  say "Home Lab Launcher is starting."
  say "Open: $app_base_url"
  say "Check status with: cd $install_dir && docker compose ps"
else
  say "Start later with: cd $install_dir && docker compose up -d"
fi
