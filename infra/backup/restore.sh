#!/bin/sh
# Restore a checksum-verified archive into an empty scratch database by default.
# Live replacement requires stopped apps, no remaining sessions and typed consent.
set -eu
umask 077
failure_reason='initialisation failed'
work_dir=''
finish() {
  result=$?
  trap - 0 HUP INT TERM
  [ "$result" -eq 0 ] || printf 'restore FAILED: %s\n' "$failure_reason" >&2
  [ -z "$work_dir" ] || rm -rf "$work_dir"
  exit "$result"
}
trap finish 0
trap 'failure_reason="interrupted"; exit 1' HUP INT TERM
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"
settings
lock_operation
work_dir=$(mktemp -d "$BACKUP_DIR/.restore.XXXXXXXX")
live=false source_file=''
for argument do
  case "$argument" in
    --into-live) live=true;;
    --*) fail 'unknown restore option';;
    *) [ -z "$source_file" ] || fail 'provide exactly one backup file'; source_file=$argument;;
  esac
done
[ -n "$source_file" ] || fail 'usage: restore <file or S3 key> [--into-live]'
base=${source_file##*/}
valid_name "$base" || fail 'unrecognized backup filename'
if [ -f "$source_file" ]; then
  archive=$source_file
elif [ -f "$BACKUP_DIR/$source_file" ]; then
  archive="$BACKUP_DIR/$source_file"
else
  s3_settings
  [ "$s3_enabled" = true ] || fail 'backup file was not found and S3 is disabled'
  case "$source_file" in
    s3://*) [ "$source_file" = "$s3_url/$base" ] || fail 'S3 source must be in the configured backup prefix';;
    */*) fail 'use a basename or a full configured S3 URL';;
  esac
  failure_reason='S3 restore download failed'
  archive="$work_dir/$base"
  s3 copyto "$s3_remote/$base.sha256" "$archive.sha256"
  s3 copyto "$s3_remote/$base" "$archive"
fi
failure_reason='checksum verification failed'
check_checksum "$archive"
if [ "$live" = true ]; then
  case "$PGDATABASE" in postgres|template0|template1) fail 'refusing to replace a maintenance database';; esac
  [ "${BACKUP_APP_STOPPED:-}" = yes ] || fail 'stop all app services and set BACKUP_APP_STOPPED=yes before live restore'
  printf 'Type the live database name (%s) to replace it: ' "$PGDATABASE" >&2
  IFS= read -r confirmation || fail 'live restore confirmation was not provided'
  [ "$confirmation" = "$PGDATABASE" ] || fail 'live restore confirmation did not match'
  target_database=$PGDATABASE
  live_database=$PGDATABASE
  failure_reason='cannot check live database connections'
  connections=$(PGDATABASE=postgres psql --no-password -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_stat_activity WHERE datname='$live_database' AND pid<>pg_backend_pid();" 2>"$work_dir/database-error")
  [ "$connections" = 0 ] || fail 'live database still has connections; stop app services first'
  failure_reason='cannot replace live database; ensure app services are stopped'
  PGDATABASE=postgres dropdb --no-password --if-exists -- "$target_database" 2>"$work_dir/database-error"
else
  suffix=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  target_database=${BACKUP_RESTORE_DATABASE:-codechatter_restore_$(date -u +%Y%m%d%H%M%S)_$suffix}
  case "$target_database" in codechatter_restore_?*) ;; *) fail 'scratch name must start with codechatter_restore_';; esac
  case "$target_database" in *[!a-zA-Z0-9_]*) fail 'invalid scratch database name';; esac
  [ "${#target_database}" -le 63 ] || fail 'scratch database name is too long'
  [ "$target_database" != "$PGDATABASE" ] || fail 'scratch database must differ from live database'
fi
failure_reason='cannot create empty restore database (target must not exist)'
PGDATABASE=postgres createdb --no-password --template=template0 -- "$target_database" 2>"$work_dir/database-error"
failure_reason='archive restore failed; incomplete target retained for inspection'
pg_restore --no-password --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$target_database" "$archive" 2>"$work_dir/database-error"
failure_reason='restored row count query failed'
for table in user rooms doc_snapshots checkpoints audit_events; do
  count=$(PGDATABASE=$target_database psql --no-password -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"$table\";" 2>"$work_dir/database-error")
  printf '%s: %s\n' "$table" "$count"
done
printf 'restore ok: %s into %s\n' "$base" "$target_database"
