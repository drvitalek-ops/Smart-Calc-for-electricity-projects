#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/restore-backup.sh BACKUP_NAME" >&2
  exit 2
fi

backup_name=$1
case "$backup_name" in *[!0-9TZ]*) echo "Invalid backup name" >&2; exit 2;; esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(dirname "$script_dir")
backup_dir="$project_root/backups/$backup_name"

for file in database.dump project-files.tar.gz SHA256SUMS backup.meta; do
  if [ ! -f "$backup_dir/$file" ]; then
    echo "Missing backup file: $backup_dir/$file" >&2
    exit 2
  fi
done

cd "$project_root"
docker compose run --rm --no-deps --entrypoint sh restore -c \
  "cd '/backups/$backup_name' && sha256sum -c SHA256SUMS"

echo "This will replace the current database and every uploaded project file."
printf "Type RESTORE to continue: "
read -r confirmation
if [ "$confirmation" != RESTORE ]; then
  echo "Restore cancelled"
  exit 1
fi

docker compose up -d db
docker compose stop frontend backend backup >/dev/null 2>&1 || true
docker compose cp "$backup_dir/database.dump" db:/tmp/smart-calc-restore.dump
docker compose exec -T db dropdb --force -U smart_calc smart_home_calc_dev
docker compose exec -T db createdb -U smart_calc smart_home_calc_dev
docker compose exec -T db pg_restore -U smart_calc -d smart_home_calc_dev \
  --no-owner --no-privileges /tmp/smart-calc-restore.dump
docker compose exec -T db rm -f /tmp/smart-calc-restore.dump
docker compose run --rm --no-deps --entrypoint sh restore -c \
  "find /data/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf '/backups/$backup_name/project-files.tar.gz' -C /data/storage"
docker compose up -d
echo "Backup $backup_name restored"
