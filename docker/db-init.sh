#!/bin/sh
# Applies ordered migrations after the base schema on the first start of an empty database volume.
# Down scripts (*.down.sql) are skipped. Runs inside the postgres image's init phase.
set -e
for f in $(ls /migrations/*.sql | grep -v '\.down\.sql$' | sort); do
  echo "applying $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done
