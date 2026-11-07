#!/bin/sh
# Exercise backup, off-server GFS retention and safe restores using Docker only.
# All resources have a private random label; the shared dev stack is never used.
# The single-quoted tool programs are intentionally expanded in their container.
# shellcheck disable=SC2016
set -eu
script_dir=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
root_dir=$(CDPATH='' cd -- "$script_dir/../.." && pwd)
prefix="cc-backup-test-$(date -u +%Y%m%d%H%M%S)-$$"
network=$prefix pg=$prefix-pg s3_server=$prefix-s3
pg_volume=$prefix-pg backups=$prefix-backups config=$prefix-config s3_volume=$prefix-s3
image=$prefix:local
cleanup() {
  result=$?
  trap - 0 HUP INT TERM
  for container in $(docker ps -aq --filter "label=codechatter.backup-test=$prefix" 2>/dev/null); do
    docker rm -f "$container" >/dev/null 2>&1 || result=1
  done
  for volume in "$pg_volume" "$backups" "$config" "$s3_volume"; do
    docker volume rm "$volume" >/dev/null 2>&1 || result=1
  done
  docker network rm "$network" >/dev/null 2>&1 || result=1
  docker image rm "$image" >/dev/null 2>&1 || :
  if [ "$result" -eq 0 ]; then printf 'PASS backup/restore drill and isolated resource cleanup\n'; else printf 'FAIL backup/restore drill (cleanup attempted for exact test resources)\n' >&2; fi
  exit "$result"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
export PGPASSWORD="disposable-$prefix" POSTGRES_PASSWORD="disposable-$prefix"
export BACKUP_S3_ACCESS_KEY=backup-test BACKUP_S3_SECRET_KEY="disposable-$prefix"
export BACKUP_S3_URL=s3://backups/codechatter BACKUP_S3_ENDPOINT="http://$s3_server:8333"
docker info >/dev/null 2>&1
printf 'Building the isolated Postgres18/rclone backup image\n'
(cd "$script_dir" && docker build -q -t "$image" . >/dev/null)
docker network create "$network" >/dev/null
for volume in "$pg_volume" "$backups" "$config" "$s3_volume"; do docker volume create "$volume" >/dev/null; done
docker run --rm -i --label "codechatter.backup-test=$prefix" -v "$config:/config" --entrypoint sh postgres:18-alpine -c 'cat > /config/s3.json' <<EOF
{"identities":[{"name":"backup-test","credentials":[{"accessKey":"$BACKUP_S3_ACCESS_KEY","secretKey":"$BACKUP_S3_SECRET_KEY"}],"actions":["Admin","Read","Write","List"]}]}
EOF
docker run -d --name "$pg" --label "codechatter.backup-test=$prefix" --network "$network" -e POSTGRES_PASSWORD -e POSTGRES_USER=codechatter -e POSTGRES_DB=codechatter -v "$pg_volume:/var/lib/postgresql" postgres:18-alpine >/dev/null
docker run -d --name "$s3_server" --label "codechatter.backup-test=$prefix" --network "$network" -v "$config:/config:ro" -v "$s3_volume:/data" chrislusf/seaweedfs:latest server -s3 -s3.port=8333 -s3.config=/config/s3.json -dir=/data >/dev/null
wait_count=0
until docker exec "$pg" pg_isready -h 127.0.0.1 -U codechatter >/dev/null 2>&1; do
  wait_count=$((wait_count + 1)); [ "$wait_count" -lt 60 ]; sleep 1
done
job() {
  docker run --rm --label "codechatter.backup-test=$prefix" --network "$network" \
    --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m -v "$backups:/backups" \
    -e PGPASSWORD -e PGHOST="$pg" -e PGUSER=codechatter -e PGDATABASE=codechatter \
    -e BACKUP_S3_ACCESS_KEY -e BACKUP_S3_SECRET_KEY -e BACKUP_S3_URL -e BACKUP_S3_ENDPOINT \
    "$@"
}
# Tool programs below intentionally expand variables inside the isolated container.
# shellcheck disable=SC2016
tool() { job --entrypoint sh "$image" -c "$1"; }
sql() { docker exec -i -e PGPASSWORD "$pg" psql --no-password -U codechatter -d "${1:-codechatter}" -X -qAt -v ON_ERROR_STOP=1; }
docker exec -i -e PGPASSWORD "$pg" psql --no-password -U codechatter -d codechatter -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public."user" (id integer PRIMARY KEY);
CREATE TABLE public.rooms (id integer PRIMARY KEY);
CREATE TABLE public.doc_snapshots (id integer PRIMARY KEY);
CREATE TABLE public.checkpoints (id integer PRIMARY KEY);
CREATE TABLE public.audit_events (id integer PRIMARY KEY);
INSERT INTO public."user" SELECT generate_series(1,3);
INSERT INTO public.rooms SELECT generate_series(1,4);
INSERT INTO public.doc_snapshots SELECT generate_series(1,5);
INSERT INTO public.checkpoints SELECT generate_series(1,6);
INSERT INTO public.audit_events SELECT generate_series(1,7);
SQL
wait_count=0
until tool 'work_dir=$(mktemp -d /backups/.s3-ready.XXXXXXXX); . /opt/codechatter-backup/common.sh; s3_settings; s3 mkdir ccbackup:backups; result=$?; rm -rf "$work_dir"; exit "$result"' >/dev/null 2>&1; do
  wait_count=$((wait_count + 1)); [ "$wait_count" -lt 60 ]; sleep 1
done
job -e BACKUP_TEST_MODE=1 -e BACKUP_TEST_NOW=2026-11-08T03:00:00Z "$image" now
printf 'PASS validated dump and verified S3 upload\n'
# Seed real, checksum-valid historical copies to exercise the complete 7/4/6 union.
tool '
set -eu
work_dir=$(mktemp -d /backups/.seed.XXXXXXXX)
. /opt/codechatter-backup/common.sh; s3_settings
for day in 2026-11-07 2026-11-06 2026-11-05 2026-11-04 2026-11-03 2026-11-02 2026-11-01 2026-10-25 2026-10-18 2026-10-11 2026-10-01 2026-09-01 2026-08-01 2026-07-01 2026-06-01 2026-05-01 2026-05-05; do
  name="codechatter-${day}T0300Z.dump"
  cp /backups/codechatter-2026-11-08T0300Z.dump "/backups/$name"
  (cd /backups && sha256sum "$name" >"$name.sha256")
  s3 copyto "/backups/$name" "$s3_remote/$name"
  s3 copyto "/backups/$name.sha256" "$s3_remote/$name.sha256"
done
# Different histories prove remote retention is not merely mirroring local deletions.
rm /backups/codechatter-2026-10-25T0300Z.dump /backups/codechatter-2026-10-25T0300Z.dump.sha256
s3 deletefile "$s3_remote/codechatter-2026-11-07T0300Z.dump"
s3 deletefile "$s3_remote/codechatter-2026-11-07T0300Z.dump.sha256"
rm -rf "$work_dir"
'
job -e BACKUP_TEST_MODE=1 -e BACKUP_TEST_NOW=2026-11-09T03:00:00Z "$image" now
tool '
set -eu
work_dir=$(mktemp -d /backups/.check.XXXXXXXX); . /opt/codechatter-backup/common.sh; s3_settings
[ "$(find /backups -maxdepth 1 -name "*.dump" | wc -l)" -eq 15 ]
for day in 2026-11-09 2026-11-08 2026-11-07 2026-11-06 2026-11-05 2026-11-04 2026-11-03 2026-11-01 2026-10-18 2026-10-11 2026-10-01 2026-09-01 2026-08-01 2026-07-01 2026-06-01; do
  [ -f "/backups/codechatter-${day}T0300Z.dump" ]
  [ -f "/backups/codechatter-${day}T0300Z.dump.sha256" ]
done
s3 lsf "$s3_remote" --files-only >"$work_dir/objects"
[ "$(grep -c "[.]dump$" "$work_dir/objects")" -eq 15 ]
grep -Fxq codechatter-2026-10-25T0300Z.dump "$work_dir/objects"
! grep -Fxq codechatter-2026-10-11T0300Z.dump "$work_dir/objects"
! grep -Fxq codechatter-2026-05-01T0300Z.dump "$work_dir/objects"
grep -Fxq codechatter-2026-11-02T0300Z.dump "$work_dir/objects"
[ ! -f /backups/codechatter-2026-11-02T0300Z.dump ]
[ -s /backups/last-success ] && [ ! -e /backups/last-failure ]
rm -rf "$work_dir"
'
printf 'PASS independent local/S3 daily7 weekly4 monthly6 retention\n'
job -e BACKUP_TEST_MODE=1 -e BACKUP_TEST_NOW=2026-01-02T03:00:00Z "$image" now
tool '[ -f /backups/codechatter-2026-11-09T0300Z.dump ] && [ -f /backups/codechatter-2026-01-02T0300Z.dump ]'
printf 'PASS clock rollback protects newest and current backup\n'
job -e BACKUP_RESTORE_DATABASE=codechatter_restore_local "$image" restore codechatter-2026-11-09T0300Z.dump
counts=$(printf 'SELECT (SELECT count(*) FROM public."user"), (SELECT count(*) FROM rooms), (SELECT count(*) FROM doc_snapshots), (SELECT count(*) FROM checkpoints), (SELECT count(*) FROM audit_events);\n' | sql codechatter_restore_local)
[ "$counts" = '3|4|5|6|7' ]
job -e BACKUP_RESTORE_DATABASE=codechatter_restore_remote "$image" restore s3://backups/codechatter/codechatter-2026-11-09T0300Z.dump
counts=$(printf 'SELECT (SELECT count(*) FROM public."user"), (SELECT count(*) FROM rooms), (SELECT count(*) FROM doc_snapshots), (SELECT count(*) FROM checkpoints), (SELECT count(*) FROM audit_events);\n' | sql codechatter_restore_remote)
[ "$counts" = '3|4|5|6|7' ]
printf 'PASS local and S3 restores match all source row counts\n'
local_log=$(job -e BACKUP_S3_URL= -e BACKUP_TEST_MODE=1 -e BACKUP_TEST_NOW=2026-01-03T03:00:00Z "$image" now)
printf '%s\n' "$local_log" | grep -Fq 'off-server DISABLED: backups are only on this server'
printf 'PASS optional local-only backup explicitly warns about off-server storage\n'
if job "$image" restore codechatter-2026-11-09T0300Z.dump --into-live >/dev/null 2>&1; then exit 1; fi
if printf 'wrong-database\n' | job -i -e BACKUP_APP_STOPPED=yes "$image" restore codechatter-2026-11-09T0300Z.dump --into-live >/dev/null 2>&1; then exit 1; fi
holder=$prefix-connection
docker run -d --name "$holder" --label "codechatter.backup-test=$prefix" --network "$network" \
  -e PGPASSWORD -e PGHOST="$pg" -e PGUSER=codechatter -e PGDATABASE=codechatter -e PGAPPNAME="$holder" \
  postgres:18-alpine psql --no-password -X -qAt -c 'SELECT pg_sleep(60);' >/dev/null
wait_count=0
until [ "$(printf "SELECT count(*) FROM pg_stat_activity WHERE datname='codechatter';\n" | sql postgres)" -gt 0 ]; do
  wait_count=$((wait_count + 1)); [ "$wait_count" -lt 30 ]; sleep 1
done
if printf 'codechatter\n' | job -i -e BACKUP_APP_STOPPED=yes "$image" restore codechatter-2026-11-09T0300Z.dump --into-live >/dev/null 2>&1; then exit 1; fi
[ "$(printf 'SELECT count(*) FROM public."user";\n' | sql)" = 3 ]
docker rm -f "$holder" >/dev/null
# A disconnected client can leave pg_sleep running until its next socket check.
# Terminate only this labelled fixture's backend, then wait for its exit.
printf "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='codechatter' AND application_name='%s';\n" "$holder" | sql postgres >/dev/null
wait_count=0
until [ "$(printf "SELECT count(*) FROM pg_stat_activity WHERE datname='codechatter';\n" | sql postgres)" = 0 ]; do
  wait_count=$((wait_count + 1)); [ "$wait_count" -lt 10 ]; sleep 1
done
printf 'codechatter\n' | job -i -e BACKUP_APP_STOPPED=yes "$image" restore codechatter-2026-11-09T0300Z.dump --into-live
[ "$(printf 'SELECT count(*) FROM public."user";\n' | sql)" = 3 ]
printf 'PASS live replacement needs correct typed name and zero active connections\n'
tool 'printf "corrupt" >> /backups/codechatter-2026-11-09T0300Z.dump'
if job -e BACKUP_RESTORE_DATABASE=codechatter_restore_corrupt "$image" restore codechatter-2026-11-09T0300Z.dump >/dev/null 2>&1; then exit 1; fi
[ "$(printf "SELECT count(*) FROM pg_database WHERE datname='codechatter_restore_corrupt';\n" | sql postgres)" = 0 ]
printf 'PASS live restore guard and pre-creation checksum rejection\n'
if job -e PGHOST=not-a-real-database -e BACKUP_TEST_MODE=1 -e BACKUP_TEST_NOW=2026-11-10T03:00:00Z "$image" now >/dev/null 2>&1; then exit 1; fi
tool '[ -s /backups/last-failure ] && [ -s /backups/last-success ] && [ ! -e /backups/codechatter-2026-11-10T0300Z.dump ]'
printf 'PASS failed dump is nonzero, leaves failure status and no partial archive\n'
for script in common.sh backup.sh restore.sh entrypoint.sh; do
  extracted=$(awk -v script="$script" '$0 == "  " script ": |" {inside=1;next} inside && substr($0,1,4)=="    " {print substr($0,5);next} inside {exit}' "$root_dir/infra/helm/codechatter/templates/backup.yaml")
  [ "$extracted" = "$(cat "$script_dir/$script")" ]
done
printf 'PASS Helm ConfigMap scripts match the Docker scripts\n'
