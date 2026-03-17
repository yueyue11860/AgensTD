#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/BE"
FRONTEND_DIR="$ROOT_DIR/FE"
RUNTIME_DIR="$ROOT_DIR/.dev-runtime"

BACKEND_PID_FILE="$RUNTIME_DIR/backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/frontend.pid"
BACKEND_LOG_FILE="$RUNTIME_DIR/backend.log"
FRONTEND_LOG_FILE="$RUNTIME_DIR/frontend.log"

BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_DEV_COMMAND="${BACKEND_DEV_COMMAND:-pnpm dev}"
FRONTEND_DEV_COMMAND="${FRONTEND_DEV_COMMAND:-pnpm exec vite --port ${FRONTEND_PORT}}"

mkdir -p "$RUNTIME_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

read_pid() {
  local pid_file="$1"

  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(tr -d '[:space:]' < "$pid_file")"
  if [[ -z "$pid" ]]; then
    return 1
  fi

  printf '%s\n' "$pid"
}

pid_is_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

pid_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true
}

pid_matches_dir() {
  local pid="$1"
  local expected_dir="$2"
  [[ "$(pid_cwd "$pid")" == "$expected_dir" ]]
}

parent_pid() {
  local pid="$1"
  ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true
}

process_group_id() {
  local pid="$1"
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true
}

top_managed_pid() {
  local pid="$1"
  local expected_dir="$2"
  local current_pid="$pid"

  if [[ -z "$current_pid" ]] || ! pid_is_running "$current_pid" || ! pid_matches_dir "$current_pid" "$expected_dir"; then
    return 1
  fi

  while true; do
    local next_pid
    next_pid="$(parent_pid "$current_pid")"

    if [[ -z "$next_pid" ]] || [[ "$next_pid" == "1" ]]; then
      break
    fi

    if ! pid_is_running "$next_pid" || ! pid_matches_dir "$next_pid" "$expected_dir"; then
      break
    fi

    current_pid="$next_pid"
  done

  printf '%s\n' "$current_pid"
}

kill_pid_group() {
  local signal="$1"
  local pid="$2"
  local pgid

  pgid="$(process_group_id "$pid")"
  if [[ -n "$pgid" ]]; then
    kill "-$signal" -- "-$pgid" 2>/dev/null || true
  fi

  kill "-$signal" "$pid" 2>/dev/null || true
}

port_listener_pid() {
  local port="$1"
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

record_listener_pid_if_managed() {
  local pid_file="$1"
  local expected_dir="$2"
  local port="$3"
  local listener_pid

  listener_pid="$(port_listener_pid "$port")"
  if [[ -n "$listener_pid" ]] && pid_matches_dir "$listener_pid" "$expected_dir"; then
    local managed_pid
    managed_pid="$(top_managed_pid "$listener_pid" "$expected_dir")"
    printf '%s\n' "$managed_pid" > "$pid_file"
    printf '%s\n' "$managed_pid"
    return 0
  fi

  return 1
}

cleanup_stale_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    rm -f "$pid_file"
  fi
}

ensure_port_is_free_or_managed() {
  local name="$1"
  local expected_dir="$2"
  local pid_file="$3"
  local port="$4"
  local listener_pid

  listener_pid="$(port_listener_pid "$port")"
  if [[ -z "$listener_pid" ]]; then
    return 0
  fi

  if pid_matches_dir "$listener_pid" "$expected_dir"; then
    local managed_pid
    managed_pid="$(top_managed_pid "$listener_pid" "$expected_dir")"
    printf '%s already running on port %s (pid %s).\n' "$name" "$port" "$managed_pid"
    printf '%s\n' "$managed_pid" > "$pid_file"
    return 1
  fi

  printf 'Port %s is occupied by pid %s, not managed by this repo.\n' "$port" "$listener_pid" >&2
  exit 1
}

wait_for_service() {
  local name="$1"
  local pid_file="$2"
  local expected_dir="$3"
  local port="$4"
  local log_file="$5"

  local pid
  pid="$(read_pid "$pid_file" || true)"

  for _ in {1..100}; do
    if [[ -n "$pid" ]] && ! pid_is_running "$pid"; then
      printf '%s exited during startup.\n' "$name" >&2
      tail -n 40 "$log_file" >&2 || true
      cleanup_stale_pid_file "$pid_file"
      exit 1
    fi

    local listener_pid
    listener_pid="$(port_listener_pid "$port")"
    if [[ -n "$listener_pid" ]] && pid_matches_dir "$listener_pid" "$expected_dir"; then
      local managed_pid
      managed_pid="$(top_managed_pid "$listener_pid" "$expected_dir")"
      printf '%s started on port %s (pid %s).\n' "$name" "$port" "$managed_pid"
      printf '%s\n' "$managed_pid" > "$pid_file"
      return 0
    fi

    sleep 0.2
  done

  printf '%s did not become ready in time. Check %s\n' "$name" "$log_file" >&2
  exit 1
}

start_service() {
  local name="$1"
  local service_dir="$2"
  local pid_file="$3"
  local log_file="$4"
  local port="$5"
  local start_command="$6"

  local pid
  pid="$(read_pid "$pid_file" || true)"
  if [[ -n "$pid" ]] && pid_is_running "$pid" && pid_matches_dir "$pid" "$service_dir"; then
    printf '%s already running (pid %s).\n' "$name" "$pid"
    return 0
  fi

  cleanup_stale_pid_file "$pid_file"
  ensure_port_is_free_or_managed "$name" "$service_dir" "$pid_file" "$port" || return 0

  : > "$log_file"
  nohup zsh -lc "cd '$service_dir' && exec ${start_command}" >> "$log_file" 2>&1 &
  pid="$!"
  printf '%s\n' "$pid" > "$pid_file"

  wait_for_service "$name" "$pid_file" "$service_dir" "$port" "$log_file"
}

stop_service() {
  local name="$1"
  local service_dir="$2"
  local pid_file="$3"
  local port="$4"
  local pid

  pid="$(read_pid "$pid_file" || true)"
  if [[ -z "$pid" ]] || ! pid_is_running "$pid" || ! pid_matches_dir "$pid" "$service_dir"; then
    pid="$(record_listener_pid_if_managed "$pid_file" "$service_dir" "$port" || true)"
  fi

  if [[ -z "$pid" ]]; then
    printf '%s is not running.\n' "$name"
    cleanup_stale_pid_file "$pid_file"
    return 0
  fi

  kill_pid_group TERM "$pid"
  for _ in {1..50}; do
    local listener_pid
    listener_pid="$(port_listener_pid "$port")"
    if [[ -z "$listener_pid" ]] || ! pid_matches_dir "$listener_pid" "$service_dir"; then
      printf '%s stopped.\n' "$name"
      cleanup_stale_pid_file "$pid_file"
      return 0
    fi

    if ! pid_is_running "$pid"; then
      sleep 0.2
    fi
    sleep 0.2
  done

  kill_pid_group KILL "$pid"

  local residual_pid
  residual_pid="$(record_listener_pid_if_managed "$pid_file" "$service_dir" "$port" || true)"
  if [[ -n "$residual_pid" ]]; then
    kill_pid_group KILL "$residual_pid"
  fi

  for _ in {1..10}; do
    local listener_pid
    listener_pid="$(port_listener_pid "$port")"
    if [[ -z "$listener_pid" ]] || ! pid_matches_dir "$listener_pid" "$service_dir"; then
      cleanup_stale_pid_file "$pid_file"
      printf '%s stopped after cleanup.\n' "$name"
      return 0
    fi
    sleep 0.2
  done

  cleanup_stale_pid_file "$pid_file"
  printf '%s stop may be incomplete; check port %s and logs if needed.\n' "$name" "$port"
}

status_service() {
  local name="$1"
  local service_dir="$2"
  local pid_file="$3"
  local port="$4"
  local log_file="$5"
  local pid

  pid="$(read_pid "$pid_file" || true)"
  if [[ -n "$pid" ]] && pid_is_running "$pid" && pid_matches_dir "$pid" "$service_dir"; then
    printf '%s: running (pid %s, port %s) log=%s\n' "$name" "$pid" "$port" "$log_file"
    return 0
  fi

  pid="$(record_listener_pid_if_managed "$pid_file" "$service_dir" "$port" || true)"
  if [[ -n "$pid" ]]; then
    printf '%s: running (pid %s, port %s) log=%s\n' "$name" "$pid" "$port" "$log_file"
    return 0
  fi

  cleanup_stale_pid_file "$pid_file"
  printf '%s: stopped\n' "$name"
}

show_logs() {
  local log_file="$1"
  if [[ ! -f "$log_file" ]]; then
    echo "Log file not found: $log_file" >&2
    exit 1
  fi

  tail -n 80 "$log_file"
}

usage() {
  cat <<EOF
Usage: ./dev-stack.sh <start|stop|restart|status|logs>

Environment overrides:
  BACKEND_PORT=$BACKEND_PORT
  FRONTEND_PORT=$FRONTEND_PORT
EOF
}

main() {
  require_command pnpm
  require_command lsof
  require_command zsh

  local command="${1:-}"
  case "$command" in
    start)
      start_service "Backend" "$BACKEND_DIR" "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE" "$BACKEND_PORT" "$BACKEND_DEV_COMMAND"
      start_service "Frontend" "$FRONTEND_DIR" "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE" "$FRONTEND_PORT" "$FRONTEND_DEV_COMMAND"
      ;;
    stop)
      stop_service "Frontend" "$FRONTEND_DIR" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"
      stop_service "Backend" "$BACKEND_DIR" "$BACKEND_PID_FILE" "$BACKEND_PORT"
      ;;
    restart)
      "$0" stop
      "$0" start
      ;;
    status)
      status_service "Backend" "$BACKEND_DIR" "$BACKEND_PID_FILE" "$BACKEND_PORT" "$BACKEND_LOG_FILE"
      status_service "Frontend" "$FRONTEND_DIR" "$FRONTEND_PID_FILE" "$FRONTEND_PORT" "$FRONTEND_LOG_FILE"
      ;;
    logs)
      echo "== Backend log =="
      show_logs "$BACKEND_LOG_FILE"
      echo
      echo "== Frontend log =="
      show_logs "$FRONTEND_LOG_FILE"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"