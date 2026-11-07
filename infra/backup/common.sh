#!/bin/sh
# Shared validation, S3 transport and GFS retention for backup and restore jobs.
# Passwords stay in environment variables; command errors are classified safely.
set -eu
# failure_reason is consumed by each calling operation's EXIT trap.
# shellcheck disable=SC2034
fail() { failure_reason=$1; exit 1; }
settings() {
  BACKUP_DIR=${BACKUP_DIR:-/backups}
  PGHOST=${PGHOST:-postgres}
  PGPORT=${PGPORT:-5432}
  PGUSER=${PGUSER:-codechatter}
  PGDATABASE=${PGDATABASE:-codechatter}
  PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}
  BACKUP_KEEP_DAILY=${BACKUP_KEEP_DAILY:-7}
  BACKUP_KEEP_WEEKLY=${BACKUP_KEEP_WEEKLY:-4}
  BACKUP_KEEP_MONTHLY=${BACKUP_KEEP_MONTHLY:-6}
  case "$PGDATABASE" in ''|*[!a-zA-Z0-9_]*) fail 'invalid database name';; esac
  case "$PGUSER" in ''|*[!a-zA-Z0-9_-]*) fail 'invalid database user';; esac
  case "$PGHOST" in ''|*://*|*[!a-zA-Z0-9._:-]*) fail 'invalid database host';; esac
  case "$PGPORT" in ''|*[!0-9]*) fail 'invalid database port';; esac
  [ -n "${PGPASSWORD:-}" ] || fail 'PGPASSWORD is required'
  for count in "$BACKUP_KEEP_DAILY" "$BACKUP_KEEP_WEEKLY" "$BACKUP_KEEP_MONTHLY"; do
    case "$count" in ''|*[!0-9]*) fail 'retention counts must be nonnegative integers';; esac
    [ "$count" -le 10000 ] || fail 'retention count is too large'
  done
  export PGHOST PGPORT PGUSER PGDATABASE PGCONNECT_TIMEOUT
  export HOME=/tmp
  mkdir -p "$BACKUP_DIR" || fail 'cannot create backup directory'
}
lock_operation() {
  exec 9>"$BACKUP_DIR/.operation.lock"
  flock -n 9 || fail 'another backup or restore is running'
}
valid_name() {
  printf '%s\n' "$1" | grep -Eq '^codechatter-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}Z\.dump$' || return 1
  name_day=$(printf '%s' "$1" | cut -c13-22)
  name_time=$(printf '%s' "$1" | cut -c24-27)
  name_hour=$(printf '%s' "$name_time" | cut -c1-2)
  name_minute=$(printf '%s' "$name_time" | cut -c3-4)
  checked_name=$(date -u -d "$name_day $name_hour:$name_minute:00" '+codechatter-%Y-%m-%dT%H%MZ.dump' 2>/dev/null) || return 1
  [ "$checked_name" = "$1" ]
}
s3_settings() {
  # Public result consumed by backup.sh and restore.sh.
  # shellcheck disable=SC2034
  s3_enabled=false
  [ -n "${BACKUP_S3_URL:-}" ] || return 0
  [ -n "${BACKUP_S3_ACCESS_KEY:-}" ] && [ -n "${BACKUP_S3_SECRET_KEY:-}" ] || fail 'S3 URL requires both S3 credentials'
  s3_url=${BACKUP_S3_URL%/}
  case "$s3_url" in s3://*) ;; *) fail 'S3 URL must start with s3://';; esac
  s3_path=${s3_url#s3://}
  case "$s3_path" in ''|/*|*[!a-zA-Z0-9._/-]*|*/../*|../*|*/..|*/./*|./*|*/.|*//*) fail 'invalid S3 bucket or prefix';; esac
  s3_bucket=${s3_path%%/*}
  case "$s3_bucket" in ''|*[!a-zA-Z0-9.-]*) fail 'invalid S3 bucket';; esac
  # Public destination consumed by the two calling operations.
  # shellcheck disable=SC2034
  s3_remote="ccbackup:$s3_path"
  RCLONE_CONFIG_CCBACKUP_TYPE=s3
  RCLONE_CONFIG_CCBACKUP_PROVIDER=AWS
  [ -z "${BACKUP_S3_ENDPOINT:-}" ] || RCLONE_CONFIG_CCBACKUP_PROVIDER=Other
  RCLONE_CONFIG_CCBACKUP_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY
  RCLONE_CONFIG_CCBACKUP_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_KEY
  RCLONE_CONFIG_CCBACKUP_REGION=${BACKUP_S3_REGION:-us-east-1}
  RCLONE_CONFIG_CCBACKUP_ENDPOINT=${BACKUP_S3_ENDPOINT:-}
  RCLONE_CONFIG_CCBACKUP_FORCE_PATH_STYLE=${BACKUP_S3_FORCE_PATH_STYLE:-true}
  export RCLONE_CONFIG_CCBACKUP_TYPE RCLONE_CONFIG_CCBACKUP_PROVIDER
  export RCLONE_CONFIG_CCBACKUP_ACCESS_KEY_ID RCLONE_CONFIG_CCBACKUP_SECRET_ACCESS_KEY
  export RCLONE_CONFIG_CCBACKUP_REGION RCLONE_CONFIG_CCBACKUP_ENDPOINT RCLONE_CONFIG_CCBACKUP_FORCE_PATH_STYLE
  # Public result consumed by the calling operation.
  # shellcheck disable=SC2034
  s3_enabled=true
}
# The caller creates its private work_dir before using the transport.
# shellcheck disable=SC2154
s3() {
  rclone --config /dev/null --log-level ERROR --retries 3 --low-level-retries 3 \
    --contimeout 15s --timeout 2m "$@" 2>"$work_dir/transport-error"
}
# Keep the newest file of each selected day, Sunday and first-of-month, plus
# the greatest timestamp and this run's file if the wall clock went backwards.
retention_plan() {
  inventory=$1 keep=$2
  : >"$keep"
  sort -ru "$inventory" >"$work_dir/sorted-names"
  daily=0 weekly=0 monthly=0 previous_day='' newest=true
  while IFS= read -r candidate; do
    valid_name "$candidate" || continue
    if [ "$newest" = true ]; then printf '%s\n' "$candidate" >>"$keep"; newest=false; fi
    [ "$candidate" != "${protected_name:-}" ] || printf '%s\n' "$candidate" >>"$keep"
    day=$(printf '%s' "$candidate" | cut -c13-22)
    [ "$day" != "$previous_day" ] || continue
    previous_day=$day
    if [ "$daily" -lt "$BACKUP_KEEP_DAILY" ]; then printf '%s\n' "$candidate" >>"$keep"; daily=$((daily + 1)); fi
    weekday=$(date -u -d "$day" +%u)
    if [ "$weekday" = 7 ] && [ "$weekly" -lt "$BACKUP_KEEP_WEEKLY" ]; then printf '%s\n' "$candidate" >>"$keep"; weekly=$((weekly + 1)); fi
    if [ "${day##*-}" = 01 ] && [ "$monthly" -lt "$BACKUP_KEEP_MONTHLY" ]; then printf '%s\n' "$candidate" >>"$keep"; monthly=$((monthly + 1)); fi
  done <"$work_dir/sorted-names"
  sort -u "$keep" -o "$keep"
}
check_checksum() {
  check_file=$1 check_base=${1##*/}
  valid_name "$check_base" || fail 'unrecognized backup filename'
  [ -f "$check_file.sha256" ] || fail 'checksum file is missing'
  [ "$(wc -l <"$check_file.sha256" | tr -d ' ')" = 1 ] || fail 'invalid checksum file'
  IFS=' ' read -r digest checksum_name <"$check_file.sha256" || fail 'invalid checksum file'
  [ "${#digest}" = 64 ] || fail 'invalid checksum digest'
  case "$digest" in *[!a-fA-F0-9]*) fail 'invalid checksum digest';; esac
  [ "$checksum_name" = "$check_base" ] || fail 'checksum filename does not match'
  actual_digest=$(sha256sum "$check_file" | cut -d ' ' -f1)
  [ "$actual_digest" = "$digest" ] || fail 'checksum mismatch'
  pg_restore --list "$check_file" >"$work_dir/archive-list" 2>"$work_dir/archive-error" || fail 'archive is not readable'
}
