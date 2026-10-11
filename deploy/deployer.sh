#!/usr/bin/env bash
# =====================================================================================================
# Jalonia — déploiement (première installation ET mises à jour).
#
#   sudo bash /opt/jalonia/depot/deploy/deployer.sh
#
# 1. récupère la dernière version de la branche main ;
# 2. la construit dans un NOUVEAU dossier (/opt/jalonia/versions/<date>-<commit>) : la version en
#    service continue de tourner pendant la construction ;
# 3. applique les migrations de la base ;
# 4. bascule le lien /opt/jalonia/courant vers la nouvelle version et redémarre le service ;
# 5. vérifie que l'application répond — sinon, RETOUR AUTOMATIQUE à la version précédente.
# Les 3 dernières versions sont conservées.
# =====================================================================================================
set -Eeuo pipefail

RACINE=/opt/jalonia
DEPOT=$RACINE/depot
VERSIONS=$RACINE/versions
COURANT=$RACINE/courant
ENV_FICHIER=/etc/jalonia/jalonia.env
A_GARDER=3

# Tout est dans une fonction : bash la lit EN ENTIER avant de l'exécuter. Indispensable, car
# « git pull » peut modifier ce fichier pendant qu'il s'exécute.
en_jalonia() { sudo -u jalonia -H "$@"; }

principal() {
  if [[ $EUID -ne 0 ]]; then echo "✘ À lancer avec sudo." >&2; exit 1; fi
  if [[ ! -r $ENV_FICHIER ]]; then echo "✘ $ENV_FICHIER introuvable." >&2; exit 1; fi

  echo "▶ 1/5 Récupération du code (branche main)…"
  en_jalonia git -C "$DEPOT" pull --ff-only --quiet
  COMMIT=$(en_jalonia git -C "$DEPOT" rev-parse --short HEAD)
  NOUVELLE="$VERSIONS/$(date +%Y%m%d-%H%M%S)-$COMMIT"
  echo "  version $COMMIT"
  # En cas d'échec AVANT la bascule : on supprime la construction ratée ; la version en service ne change pas.
  trap 'echo "✘ Échec : la version en service n'"'"'a pas changé." >&2; rm -rf -- "$NOUVELLE"' ERR

  echo "▶ 2/5 Construction dans $NOUVELLE (quelques minutes)…"
  en_jalonia mkdir -p "$NOUVELLE"
  en_jalonia bash -c "git -C '$DEPOT' archive HEAD | tar -x -C '$NOUVELLE'"
  cd "$NOUVELLE"
  en_jalonia npm ci --no-audit --no-fund --loglevel=error
  en_jalonia env NODE_OPTIONS=--max-old-space-size=1536 NEXT_TELEMETRY_DISABLED=1 npm run build
  # La sortie autonome n'embarque ni les fichiers statiques ni (par prudence) les migrations : on les copie.
  en_jalonia mkdir -p .next/standalone/.next/static .next/standalone/db
  en_jalonia cp -r .next/static/. .next/standalone/.next/static/
  en_jalonia cp -r db/. .next/standalone/db/
  if [[ -d public ]]; then en_jalonia mkdir -p .next/standalone/public && en_jalonia cp -r public/. .next/standalone/public/; fi

  echo "▶ 3/5 Migrations de la base…"
  en_jalonia npx tsx --env-file="$ENV_FICHIER" scripts/migrer.ts

  echo "▶ 4/5 Bascule vers la nouvelle version…"
  trap - ERR
  ANCIENNE=""
  if [[ -L $COURANT ]]; then ANCIENNE=$(readlink -f "$COURANT"); fi
  ln -sfn "$NOUVELLE/.next/standalone" "$COURANT.tmp"
  mv -Tf "$COURANT.tmp" "$COURANT"
  systemctl restart jalonia

  echo "▶ 5/5 Contrôle de santé…"
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 http://127.0.0.1:3000/api/sante >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  if [[ $ok -ne 1 ]]; then
    echo "✘ La nouvelle version ne répond pas. Dernières lignes du journal du service :" >&2
    journalctl -u jalonia -n 40 --no-pager >&2 || true
    if [[ -n $ANCIENNE && -d $ANCIENNE ]]; then
      ln -sfn "$ANCIENNE" "$COURANT.tmp"
      mv -Tf "$COURANT.tmp" "$COURANT"
      systemctl restart jalonia
      echo "↩ Retour à la version précédente ($ANCIENNE)." >&2
    fi
    rm -rf -- "$NOUVELLE"
    exit 1
  fi

  # Ménage : on garde les $A_GARDER versions les plus récentes (jamais celle en service).
  EN_SERVICE=$(readlink -f "$COURANT")
  mapfile -t ANCIENNES < <(ls -1dt "$VERSIONS"/*/ 2>/dev/null | tail -n +$((A_GARDER + 1)))
  for v in "${ANCIENNES[@]}"; do
    v=${v%/}
    if [[ $EN_SERVICE != "$v"/* ]]; then rm -rf -- "$v"; fi
  done

  echo "✔ Jalonia $COMMIT est en service."
}

principal "$@"
exit
