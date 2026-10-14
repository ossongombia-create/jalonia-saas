#!/bin/sh
# Restaure la dernière sauvegarde hors VPS dans une base temporaire, puis vérifie les chaînes d'audit
# contre l'ancre stockée dans la même sauvegarde. Aucun changement à la base de production.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "À lancer en root." >&2
  exit 1
fi
if [ ! -r /etc/jalonia/sauvegardes.env ]; then
  echo "Configuration hors VPS absente : /etc/jalonia/sauvegardes.env." >&2
  exit 1
fi
set -a
. /etc/jalonia/sauvegardes.env
set +a
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY manquant}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD manquant}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID manquant}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY manquant}"

TMP=$(mktemp -d /var/tmp/jalonia-restauration.XXXXXX)
BASE="jalonia_restore_$(date +%s)_$$"
nettoyer() {
  sudo -u postgres dropdb --if-exists "$BASE" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap nettoyer EXIT HUP INT TERM

restic restore latest --tag jalonia --target "$TMP"
DOSSIER="$TMP/var/backups/jalonia"
DUMP=$(find "$DOSSIER" -maxdepth 1 -type f -name 'jalonia-*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
ANCRE=$(find "$DOSSIER" -maxdepth 1 -type f -name 'ancres-*.txt' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[ -n "$DUMP" ] && [ -n "$ANCRE" ] || { echo "Dump ou ancre absent de la sauvegarde restaurée." >&2; exit 1; }
pg_restore --list "$DUMP" >/dev/null
sudo -u postgres createdb "$BASE"
sudo -u postgres pg_restore --exit-on-error --no-owner --no-privileges --dbname="$BASE" "$DUMP"

# Le restaurateur de journaux utilise le code de l'application mais se connecte localement comme postgres.
RACINE=$(readlink -f /opt/jalonia/courant)
sudo -u postgres env DATABASE_URL_PROPRIETAIRE="postgresql:///?host=/var/run/postgresql&dbname=$BASE&user=postgres" \
  /usr/bin/node "$RACINE/node_modules/tsx/dist/cli.mjs" "$RACINE/scripts/verifier-journal.ts" --ancres "$ANCRE"
echo "✔ Restauration temporaire et contrôle des journaux réussis; la base de production n'a pas été modifiée."
