#!/bin/sh
# Publish a validated atomic Postgres archive and apply local/off-server retention.
# An exclusive volume lock and checksum-last upload protect overlapping runs.
set -eu
umask 077
failure_reason='initialisation failed'
work_dir= target= published=false local_complete=false status_ready=false
finish() {
  result=$?
  trap - 0 HUP INT TERM
  if [ "$result" -ne 0 ]; then
    if [ "$published" = true ] && [ "$local_complete" = false ]; then rm -f "$target" "$target.sha256"; fi
    if [ "$status_ready" = true ]; then
      printf '%s\n' "$failure_reason" >"$BACKUP_DIR/.last-failure.$$" && mv -f "$BACKUP_DIR/.last-failure.$$" "$BACKUP_DIR/last-failure" || :
    fi
    printf 'backup FAILED: %s\n' "$failure_reason" >&2
  fi
  [ -z "$work_dir" ] || rm -rf "$work_dir"
  exit "$result"
}
trap finish 0
trap 'failure_reason="interrupted"; exit 1' HUP INT TERM
. "$(dirname "$0")/common.sh"
settings
lock_operation
status_ready=true
work_dir=$(mktemp -d "$BACKUP_DIR/.backup.XXXXXXXX")
started=$(date -u +%s)
if [ -n "${BACKUP_TEST_NOW:-}" ]; then
  [ "${BACKUP_TEST_MODE:-}" = 1 ] || fail 'fake date is only allowed in test mode'
  stamp=$(date -u -d "$BACKUP_TEST_NOW" +%Y-%m-%dT%H%MZ 2>/dev/null) || fail 'invalid fake UTC date'
else
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
fi
protected_name="codechatter-$stamp.dump"
valid_name "$protected_name" || fail 'invalid UTC timestamp'
target="$BACKUP_DIR/$protected_name"
[ ! -e "$target" ] && [ ! -e "$target.sha256" ] || fail 'backup already exists for this UTC minute'
s3_settings
failure_reason='database dump failed'
pg_dump --no-password --format=custom --compress=9 --file="$work_dir/archive.part" 2>"$work_dir/database-error"
failure_reason='archive validation failed'
pg_restore --list "$work_dir/archive.part" >"$work_dir/archive-list" 2>"$work_dir/archive-error"
digest=$(sha256sum "$work_dir/archive.part" | cut -d ' ' -f1)
printf '%s  %s\n' "$digest" "$protected_name" >"$work_dir/checksum.part"
failure_reason='cannot publish local backup'
mv "$work_dir/archive.part" "$target"
published=true
mv "$work_dir/checksum.part" "$target.sha256"
local_complete=true
if [ "$s3_enabled" = true ]; then
  failure_reason='S3 dump upload failed'
  s3 copyto "$target" "$s3_remote/$protected_name"
  failure_reason='S3 checksum upload failed'
  s3 copyto "$target.sha256" "$s3_remote/$protected_name.sha256"
  failure_reason='S3 uploaded checksum verification failed'
  s3 copyto "$s3_remote/$protected_name.sha256" "$work_dir/remote.sha256"
  cmp -s "$target.sha256" "$work_dir/remote.sha256" || fail 'S3 uploaded checksum differs'
  failure_reason='S3 uploaded archive verification failed'
  s3 copyto "$s3_remote/$protected_name" "$work_dir/remote.dump"
  [ "$(sha256sum "$work_dir/remote.dump" | cut -d ' ' -f1)" = "$digest" ] || fail 'S3 uploaded archive differs'
  rm -f "$work_dir/remote.dump"
  printf 'off-server: dump and checksum uploaded and verified\n'
else
  printf 'off-server DISABLED: backups are only on this server\n'
fi
failure_reason='local retention failed'
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'codechatter-*.dump' -printf '%f\n' >"$work_dir/local-inventory"
retention_plan "$work_dir/local-inventory" "$work_dir/local-keep"
while IFS= read -r candidate; do
  valid_name "$candidate" || continue
  grep -Fxq "$candidate" "$work_dir/local-keep" && continue
  printf 'delete local: %s\n' "$candidate"
  rm -f "$BACKUP_DIR/$candidate" "$BACKUP_DIR/$candidate.sha256"
done <"$work_dir/local-inventory"
if [ "$s3_enabled" = true ]; then
  failure_reason='S3 retention listing failed'
  s3 lsf "$s3_remote" --files-only --max-depth 1 >"$work_dir/remote-objects"
  : >"$work_dir/remote-inventory"
  while IFS= read -r candidate; do
    valid_name "$candidate" || continue
    grep -Fxq "$candidate.sha256" "$work_dir/remote-objects" || continue
    printf '%s\n' "$candidate" >>"$work_dir/remote-inventory"
  done <"$work_dir/remote-objects"
  retention_plan "$work_dir/remote-inventory" "$work_dir/remote-keep"
  failure_reason='S3 retention deletion failed'
  while IFS= read -r object; do
    candidate=${object%.sha256}
    valid_name "$candidate" || continue
    grep -Fxq "$candidate" "$work_dir/remote-keep" && continue
    printf 'delete S3: %s\n' "$object"
    s3 deletefile "$s3_remote/$object"
  done <"$work_dir/remote-objects"
fi
failure_reason='cannot write success status'
date -u +%s >"$BACKUP_DIR/.last-success.$$"
mv -f "$BACKUP_DIR/.last-success.$$" "$BACKUP_DIR/last-success"
rm -f "$BACKUP_DIR/last-failure"
size=$(wc -c <"$target" | tr -d ' ')
duration=$(( $(date -u +%s) - started ))
[ "$duration" -ge 0 ] || duration=0
printf 'backup ok: %s %s %ss\n' "$protected_name" "$size" "$duration"
