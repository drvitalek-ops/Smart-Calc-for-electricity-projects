#!/bin/sh
set -eu

backup_root=/backups
storage_root=/data/storage
interval_hours=${BACKUP_INTERVAL_HOURS:-24}
retention_days=${BACKUP_RETENTION_DAYS:-14}

case "$interval_hours" in *[!0-9]*|'') echo "BACKUP_INTERVAL_HOURS must be a positive integer" >&2; exit 1;; esac
case "$retention_days" in *[!0-9]*|'') echo "BACKUP_RETENTION_DAYS must be a non-negative integer" >&2; exit 1;; esac
if [ "$interval_hours" -lt 1 ]; then echo "BACKUP_INTERVAL_HOURS must be at least 1" >&2; exit 1; fi

interval_seconds=${BACKUP_INTERVAL_SECONDS:-$((interval_hours * 3600))}
case "$interval_seconds" in *[!0-9]*|'') echo "Backup interval must be a positive integer" >&2; exit 1;; esac
if [ "$interval_seconds" -lt 1 ]; then echo "Backup interval must be at least one second" >&2; exit 1; fi
temporary=
cleanup() {
  if [ -n "$temporary" ] && [ -d "$temporary" ]; then
    rm -rf -- "$temporary"
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$backup_root"
echo "Smart Home Calc automatic backup service started"

while true; do
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  target="$backup_root/$timestamp"
  if [ -e "$target" ]; then
    sleep 1
    continue
  fi
  temporary="$backup_root/.tmp-$timestamp-$$"
  mkdir "$temporary"

  echo "Creating backup $timestamp"
  pg_dump --format=custom --no-owner --no-privileges --file="$temporary/database.dump"
  tar -czf "$temporary/project-files.tar.gz" -C "$storage_root" .
  (
    cd "$temporary"
    sha256sum database.dump project-files.tar.gz > SHA256SUMS
  )
  printf 'created_utc=%s\ndatabase=%s\nstorage=project-files.tar.gz\nformat_version=1\n' \
    "$timestamp" "${PGDATABASE:-smart_home_calc_dev}" > "$temporary/backup.meta"
  mv "$temporary" "$target"
  temporary=
  echo "Backup $timestamp completed"

  if [ "$retention_days" -gt 0 ]; then
    find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
      -name '20??????T??????Z' -mtime "+$retention_days" -exec rm -rf -- {} +
  fi
  sleep "$interval_seconds"
done
