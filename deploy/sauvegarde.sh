#!/bin/sh
# Jalonia — sauvegarde quotidienne de la base (installée dans /etc/cron.daily/jalonia-sauvegarde).
# Garde 14 jours. Les rôles PostgreSQL (dont celui de chaque organisation) sont sauvegardés aussi :
# ils sont indispensables à une restauration.
# CONSEIL : copier régulièrement /var/backups/jalonia HORS du VPS (une sauvegarde sur la même machine
# ne protège pas contre la perte de la machine).
set -eu

DOSSIER=/var/backups/jalonia
JOUR=$(date +%F)
umask 077
mkdir -p "$DOSSIER"

sudo -u postgres pg_dump --format=custom jalonia > "$DOSSIER/jalonia-$JOUR.dump"
sudo -u postgres pg_dumpall --roles-only > "$DOSSIER/roles-$JOUR.sql"

find "$DOSSIER" -type f \( -name 'jalonia-*.dump' -o -name 'roles-*.sql' \) -mtime +14 -delete
