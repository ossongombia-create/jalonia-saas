#!/usr/bin/env bash
# shellcheck disable=SC2329 # les fonctions de contrôle sont appelées par « controle » (shellcheck ne le voit pas)
# =====================================================================================================
# Jalonia — déploiement (première installation ET mises à jour).
#
#   jalonia-deployer               (en root : copie installée dans /usr/local/sbin, voir INSTALL-VPS.md)
#   jalonia-deployer --verifier    (contrôles de sécurité seulement, sans rien déployer)
#
# 1. récupère la dernière version de la branche main ;
# 2. la construit dans un NOUVEAU dossier (/opt/jalonia/versions/<date>-<commit>) : la version en
#    service continue de tourner pendant la construction ;
# 3. applique les migrations de la base ;
# 4. bascule le lien /opt/jalonia/courant vers la nouvelle version et redémarre le service ;
# 5. vérifie que l'application répond — sinon, RETOUR AUTOMATIQUE à la version précédente ;
# 6. contrôles de sécurité (avertissements, sans effet sur la version en service).
# Les 3 dernières versions sont conservées.
#
# Trois comptes, trois rôles (audit S0, S1) :
#   - root lance CE script, depuis une copie qui lui appartient (/usr/local/sbin/jalonia-deployer) :
#     il n'exécute jamais un script modifiable par un autre compte ;
#   - « jalonia » récupère le code, le construit et lance les migrations (il lit le fichier du rôle
#     propriétaire de la base, /etc/jalonia/proprietaire.env) ;
#   - « jalonia-run » fait tourner l'application : il ne peut modifier ni le code, ni ce script, et ne
#     peut lire aucun fichier de configuration (systemd lui transmet /etc/jalonia/jalonia.env, qui ne
#     contient PAS le mot de passe du rôle propriétaire).
# =====================================================================================================
set -Eeuo pipefail

RACINE=/opt/jalonia
DEPOT=$RACINE/depot
VERSIONS=$RACINE/versions
COURANT=$RACINE/courant
ENV_SERVICE=/etc/jalonia/jalonia.env
ENV_PROPRIETAIRE=/etc/jalonia/proprietaire.env
INSTALLE=/usr/local/sbin/jalonia-deployer
UTILISATEUR_SERVICE=jalonia-run
A_GARDER=3
SCRIPT=$(readlink -f "${BASH_SOURCE[0]}")

# Tout est dans des fonctions : bash lit le fichier EN ENTIER avant d'exécuter « principal ». Indispensable,
# car « git pull » peut modifier ce fichier pendant qu'il s'exécute (quand il est lancé depuis le dépôt).
en_jalonia() { sudo -u jalonia -H "$@"; }
en_service() { sudo -u "$UTILISATEUR_SERVICE" "$@"; }

sante() { curl -fsS --max-time 5 http://127.0.0.1:3000/api/sante >/dev/null 2>&1; }

# ---------- Contrôles de sécurité ----------
ECHECS=0
controle() {
  local libelle=$1
  shift
  if "$@"; then
    echo "  ✔ $libelle"
  else
    echo "  ✘ $libelle"
    ECHECS=$((ECHECS + 1))
  fi
}

service_sous_compte_dedie() { [[ $(systemctl show -p User --value jalonia) == "$UTILISATEUR_SERVICE" ]]; }
compte_service_existe() { id -u "$UTILISATEUR_SERVICE" >/dev/null 2>&1; }
processus_sous_compte_dedie() {
  local pid uid
  pid=$(systemctl show -p MainPID --value jalonia)
  [[ -n $pid && $pid != 0 ]] && compte_service_existe || return 1
  # Identifiant effectif du processus (3e champ de la ligne « Uid: »), comparé à celui du compte.
  uid=$(awk '/^Uid:/ { print $3 }' "/proc/$pid/status")
  [[ $uid == "$(id -u "$UTILISATEUR_SERVICE")" ]]
}
# Chaque vérification « ne peut pas » exige d'abord que le compte existe (sinon sudo échouerait… et le
# contrôle passerait à tort).
code_non_modifiable() {
  local en_service_reel
  en_service_reel=$(readlink -f "$COURANT")
  compte_service_existe || return 1
  ! en_service test -w "$en_service_reel" && ! en_service test -w "$en_service_reel/server.js" \
    && ! en_service test -w "$VERSIONS" && ! en_service test -w "$RACINE"
}
scripts_non_modifiables() {
  compte_service_existe || return 1
  ! en_service test -w "$DEPOT/deploy/deployer.sh" && ! en_service test -w "$DEPOT" \
    && { [[ ! -e $INSTALLE ]] || ! en_service test -w "$INSTALLE"; }
}
configuration_illisible() {
  compte_service_existe || return 1
  ! en_service test -r "$ENV_SERVICE" && { [[ ! -e $ENV_PROPRIETAIRE ]] || ! en_service test -r "$ENV_PROPRIETAIRE"; }
}
service_sans_proprietaire() { ! grep -q '^[[:space:]]*\(export[[:space:]]\+\)\?DATABASE_URL_PROPRIETAIRE=' "$ENV_SERVICE"; }
# Clé du second facteur : sans elle, les superadmins ne peuvent plus se connecter à l'interface (obligatoire).
cle_second_facteur() { grep -q '^CLE_SECOND_FACTEUR=[A-Za-z0-9+/]\{43\}=$' "$ENV_SERVICE"; }
copie_installee_a_jour() { [[ -f $INSTALLE ]] && cmp -s "$INSTALLE" "$DEPOT/deploy/deployer.sh"; }
copie_installee_protegee() {
  [[ -f $INSTALLE && ! -L $INSTALLE && $(stat -c %u "$INSTALLE") == 0 ]] && (( (8#$(stat -c %a "$INSTALLE") & 8#022) == 0 ))
}

controles() {
  ECHECS=0
  echo "▶ Contrôles de sécurité"
  controle "le service tourne sous le compte $UTILISATEUR_SERVICE" service_sous_compte_dedie
  controle "le processus en service appartient à $UTILISATEUR_SERVICE" processus_sous_compte_dedie
  controle "$UTILISATEUR_SERVICE ne peut pas modifier le code en service" code_non_modifiable
  controle "$UTILISATEUR_SERVICE ne peut pas modifier le dépôt ni le script de déploiement" scripts_non_modifiables
  controle "$UTILISATEUR_SERVICE ne peut lire aucun fichier de /etc/jalonia" configuration_illisible
  controle "le service ne reçoit pas le mot de passe du rôle propriétaire" service_sans_proprietaire
  controle "la clé du second facteur (CLE_SECOND_FACTEUR) est configurée" cle_second_facteur
  controle "$INSTALLE appartient à root et n'est modifiable que par lui" copie_installee_protegee
  controle "$INSTALLE est identique à la version du dépôt" copie_installee_a_jour
  controle "l'application répond" sante
  if (( ECHECS > 0 )); then
    echo "⚠ $ECHECS contrôle(s) en échec : voir deploy/INSTALL-VPS.md (« Durcissement d'une installation existante » et « Au quotidien »)." >&2
    return 1
  fi
  echo "✔ Tous les contrôles sont satisfaits."
}

# ---------- Fichier d'environnement des migrations ----------
env_migrations() {
  if en_jalonia test -r "$ENV_PROPRIETAIRE"; then
    echo "$ENV_PROPRIETAIRE"
  elif en_jalonia test -r "$ENV_SERVICE" && grep -q '^DATABASE_URL_PROPRIETAIRE=' "$ENV_SERVICE"; then
    # Installation pas encore durcie : le mot de passe propriétaire est encore dans le fichier du service.
    echo "  ⚠ $ENV_PROPRIETAIRE absent : migrations avec $ENV_SERVICE (installation à durcir)." >&2
    echo "$ENV_SERVICE"
  else
    echo "✘ Aucun fichier lisible par « jalonia » ne contient DATABASE_URL_PROPRIETAIRE ($ENV_PROPRIETAIRE)." >&2
    return 1
  fi
}

deployer() {
  if [[ ! -r $ENV_SERVICE ]]; then echo "✘ $ENV_SERVICE introuvable." >&2; exit 1; fi

  # Le script doit être la copie de root. Depuis le dépôt (modifiable par « jalonia »), il n'est toléré
  # que tant que la copie n'est pas installée (première installation, ou installation à durcir).
  if [[ $SCRIPT != "$INSTALLE" ]]; then
    if [[ -e $INSTALLE ]]; then
      echo "✘ Lancez « jalonia-deployer » (copie de root), pas $SCRIPT." >&2
      exit 1
    fi
    echo "  ⚠ Lancé depuis $SCRIPT : installez la copie de root (deploy/INSTALL-VPS.md, « Durcissement »)." >&2
  fi

  echo "▶ 1/5 Récupération du code (branche main)…"
  en_jalonia git -C "$DEPOT" pull --ff-only --quiet
  COMMIT=$(en_jalonia git -C "$DEPOT" rev-parse --short HEAD)
  echo "  version $COMMIT"

  # Le script de déploiement a changé dans le dépôt : root ne l'exécute pas tant qu'il ne l'a pas installé.
  if [[ $SCRIPT == "$INSTALLE" ]] && ! cmp -s "$INSTALLE" "$DEPOT/deploy/deployer.sh"; then
    {
      echo "✘ Le script de déploiement a changé dans cette version. Rien n'a été construit ; la version en"
      echo "  service n'a pas changé. Relisez la différence, installez la nouvelle copie, puis relancez :"
      echo "    diff -u $INSTALLE $DEPOT/deploy/deployer.sh"
      echo "    install -o root -g root -m 750 $DEPOT/deploy/deployer.sh $INSTALLE"
      echo "    jalonia-deployer"
    } >&2
    exit 1
  fi

  ENV_MIGRATIONS=$(env_migrations)
  NOUVELLE="$VERSIONS/$(date +%Y%m%d-%H%M%S)-$COMMIT"
  # En cas d'échec AVANT la bascule : on supprime la construction ratée ; la version en service ne change pas.
  trap 'echo "✘ Échec : la version en service n'"'"'a pas changé." >&2; rm -rf -- "$NOUVELLE"' ERR

  echo "▶ 2/5 Construction dans $NOUVELLE (quelques minutes)…"
  en_jalonia mkdir -p "$NOUVELLE"
  en_jalonia bash -c "git -C '$DEPOT' archive HEAD | tar -x -C '$NOUVELLE'"
  cd "$NOUVELLE"
  en_jalonia npm ci --no-audit --no-fund --loglevel=error
  en_jalonia env NODE_OPTIONS=--max-old-space-size=1536 NEXT_TELEMETRY_DISABLED=1 npm run build
  # La sortie autonome n'embarque pas les fichiers statiques : on les copie. (Les migrations n'y sont plus :
  # l'application ne les lit pas ; les gabarits des organisations sont rangés dans la base.)
  en_jalonia mkdir -p .next/standalone/.next/static
  en_jalonia cp -r .next/static/. .next/standalone/.next/static/
  if [[ -d public ]]; then en_jalonia mkdir -p .next/standalone/public && en_jalonia cp -r public/. .next/standalone/public/; fi

  echo "▶ 3/5 Migrations de la base…"
  en_jalonia npx tsx --env-file="$ENV_MIGRATIONS" scripts/migrer.ts

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
    if sante; then ok=1; break; fi
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
  # shellcheck disable=SC2012 # noms de dossiers créés par ce script (date-commit) : ls suffit.
  mapfile -t ANCIENNES < <(ls -1dt "$VERSIONS"/*/ 2>/dev/null | tail -n +$((A_GARDER + 1)))
  for v in "${ANCIENNES[@]}"; do
    v=${v%/}
    if [[ $EN_SERVICE != "$v"/* ]]; then rm -rf -- "$v"; fi
  done

  echo "✔ Jalonia $COMMIT est en service."
  # Contrôles : un échec est signalé, mais la version reste en service (elle répond).
  controles || true
}

principal() {
  if [[ $EUID -ne 0 ]]; then echo "✘ À lancer en root (sudo)." >&2; exit 1; fi
  case "${1:-}" in
    "") deployer ;;
    --verifier) controles ;;
    *) echo "Usage : jalonia-deployer [--verifier]" >&2; exit 2 ;;
  esac
}

principal "$@"
exit
