#!/bin/sh
# Run one-off operations or one backup per local calendar day after 03:00.
# Rechecking the clock avoids DST drift; the persisted attempt day survives restart.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
case "${1:-schedule}" in
  now) shift; [ "$#" -eq 0 ] || exit 2; exec "$script_dir/backup.sh";;
  restore) shift; exec "$script_dir/restore.sh" "$@";;
  schedule) [ "$#" -eq 0 ] || shift;;
  *) printf 'usage: backup [schedule|now|restore <file> [--into-live]]\n' >&2; exit 2;;
esac
[ "$#" -eq 0 ] || exit 2
BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_TZ=${BACKUP_TZ:-UTC}
case "$BACKUP_TZ" in ''|/*|*..*|*[!a-zA-Z0-9_+/-]*) printf 'backup FAILED: invalid time zone\n' >&2; exit 1;; esac
[ -f "/usr/share/zoneinfo/$BACKUP_TZ" ] || { printf 'backup FAILED: unknown time zone\n' >&2; exit 1; }
export TZ=$BACKUP_TZ
mkdir -p "$BACKUP_DIR"
trap 'exit 0' INT TERM
printf 'backup schedule: 03:00 in %s\n' "$BACKUP_TZ"
while :; do
  today=$(date +%F)
  hour=$(date +%H)
  last_day=$(cat "$BACKUP_DIR/last-scheduled-day" 2>/dev/null || :)
  if [ "$hour" -ge 3 ] && { [ -z "$last_day" ] || [ "$today" \> "$last_day" ]; }; then
    printf '%s\n' "$today" >"$BACKUP_DIR/.last-scheduled-day.$$"
    mv -f "$BACKUP_DIR/.last-scheduled-day.$$" "$BACKUP_DIR/last-scheduled-day"
    "$script_dir/backup.sh" || :
  fi
  sleep 30 & wait "$!" || :
done
