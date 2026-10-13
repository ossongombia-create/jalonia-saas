#!/bin/sh
# Jalonia — sauvegarde quotidienne de la base (installée dans /etc/cron.daily/jalonia-sauvegarde).
# Garde 14 jours. Les rôles PostgreSQL (dont celui de chaque organisation) sont sauvegardés aussi :
# ils sont indispensables à une restauration.
# Écrit aussi les ANCRES des journaux (dernière empreinte de chaque chaîne, audit S6) : une copie gardée hors du
# serveur permet de prouver plus tard qu'aucune ligne antérieure n'a été retouchée
# (scripts/verifier-journal.ts --ancres fichier).
# CONSEIL : copier régulièrement /var/backups/jalonia HORS du VPS (une sauvegarde sur la même machine
# ne protège pas contre la perte de la machine).
set -eu

DOSSIER=${JALONIA_SAUVEGARDES:-/var/backups/jalonia}
BASE=${JALONIA_BASE:-jalonia}
JOUR=$(date +%F)
umask 077
mkdir -p "$DOSSIER"

# (Les fichiers sont écrits par root, lisibles par lui seul : c'est voulu — shellcheck SC2024.)
# shellcheck disable=SC2024
sudo -u postgres pg_dump --format=custom "$BASE" > "$DOSSIER/jalonia-$JOUR.dump"
# shellcheck disable=SC2024
sudo -u postgres pg_dumpall --roles-only > "$DOSSIER/roles-$JOUR.sql"

find "$DOSSIER" -type f \( -name 'jalonia-*.dump' -o -name 'roles-*.sql' \) -mtime +14 -delete

# Ancres : « journal|rang|empreinte » pour la plateforme puis chaque organisation (noms de schéma contrôlés par la
# base : org_ suivi de 12 caractères hexadécimaux).
requete() { sudo -u postgres psql -d "$BASE" -v ON_ERROR_STOP=1 -Atc "$1"; }
{
  echo "# Jalonia — ancres des journaux, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  requete "SELECT 'platform|' || chaine_rang || '|' || chaine_empreinte FROM platform.journal ORDER BY chaine_rang DESC LIMIT 1"
  for s in $(requete "SELECT schema_name FROM platform.organisations WHERE schema_name ~ '^org_[0-9a-f]{12}\$' ORDER BY schema_name"); do
    requete "SELECT '$s|' || chaine_rang || '|' || chaine_empreinte FROM \"$s\".journal ORDER BY chaine_rang DESC LIMIT 1"
  done
} > "$DOSSIER/ancres-$JOUR.txt"
