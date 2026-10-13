# Installer Jalonia sur le VPS (Ubuntu 26.04)

Serveur : Vultr, 1 Go de mémoire, IP **155.138.146.14**. Adresse finale : **https://jalonia.mosa-apps.com**.

Durée : environ 30 minutes. Chaque bloc se copie-colle **tel quel**, dans l'ordre, dans une session SSH
connectée en **root**. Si vous êtes connecté avec un autre utilisateur, tapez d'abord `sudo -i`.

> **Si un collage affiche `^[[200~` au début de la commande** (« command not found ») : le terminal ne gère
> pas le « collage encadré ». Tapez **au clavier** `bind 'set enable-bracketed-paste off'`, puis, pour que
> ce soit permanent : `echo 'set enable-bracketed-paste off' >> ~/.inputrc`.

> Aucune valeur secrète n'est à recopier à la main : les mots de passe de la base et le secret des sessions
> sont générés sur le serveur et ne quittent jamais les fichiers `/etc/jalonia/jalonia.env` (configuration
> de l'application, lue par systemd) et `/etc/jalonia/proprietaire.env` (mot de passe du rôle propriétaire
> de la base, lu seulement pour les migrations).

> **Jalonia est déjà installé et en service ?** Ne refaites pas les étapes ci-dessous : appliquez une fois les
> sections [Durcissement d'une installation existante](#durcissement-dune-installation-existante-une-fois),
> [Second facteur sur une installation existante](#second-facteur-sur-une-installation-existante-une-fois) et
> [Ancres des journaux sur une installation existante](#ancres-des-journaux-sur-une-installation-existante-une-fois).

---

## Étape 0 — Le nom de domaine (chez le gestionnaire DNS de mosa-apps.com)

Créez un enregistrement **A** : nom `jalonia`, valeur `155.138.146.14`, TTL par défaut.
**Chez Cloudflare : nuage GRIS (« DNS only »)**, pas orange. Avec le nuage orange, Caddy ne gère pas
lui-même le certificat et Jalonia enregistrerait l'adresse IP de Cloudflare au lieu de celle des utilisateurs.
Vérifiez ensuite depuis le serveur (étape 1) que le nom répond :

```bash
getent ahostsv4 jalonia.mosa-apps.com
```

La réponse doit contenir `155.138.146.14`. Sinon, attendez quelques minutes avant l'étape 9 (le certificat
HTTPS ne peut pas être obtenu tant que le nom ne pointe pas vers le serveur).

## Étape 1 — Se connecter et mettre le système à jour

Depuis votre PC (PowerShell) :

```bash
ssh root@155.138.146.14
```

Puis, sur le serveur :

```bash
apt update && apt -y full-upgrade
apt install -y git curl ca-certificates gnupg openssl ufw fail2ban postgresql caddy
psql --version
```

`psql --version` doit afficher **16 ou plus** (Ubuntu 26.04 fournit une version plus récente : c'est bon).
Si le serveur demande un redémarrage (`ls /var/run/reboot-required` affiche le fichier) : `reboot`, puis
reconnectez-vous.

## Étape 2 — Mémoire d'appoint (swap de 4 Go)

Indispensable avec 1 Go de mémoire : la construction de l'application en a besoin.

```bash
swapon --show
```

Si cette commande **n'affiche rien**, créez le swap :

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-jalonia.conf && sysctl --system >/dev/null
free -h
```

## Étape 3 — Pare-feu et protection SSH

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban
ufw status
```

Seuls SSH (22), HTTP (80) et HTTPS (443) sont ouverts. PostgreSQL et l'application ne sont **pas**
joignables depuis Internet.

## Étape 4 — Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt install -y nodejs
node -v
```

`node -v` doit afficher `v24.…`.

## Étape 5 — Comptes système et dossiers

Deux comptes, sans mot de passe ni connexion possible :

- **jalonia** récupère le code, le construit et lance les migrations de la base ;
- **jalonia-run** fait tourner l'application. Il ne possède rien : il ne peut modifier ni le code, ni le
  script de déploiement, ni lire les fichiers de configuration.

```bash
useradd --system --create-home --home-dir /home/jalonia --shell /usr/sbin/nologin jalonia
useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin jalonia-run
mkdir -p /opt/jalonia/versions
chown -R jalonia:jalonia /opt/jalonia
```

## Étape 6 — Accès au dépôt GitHub privé (clé de déploiement)

```bash
sudo -u jalonia -H mkdir -p -m 700 /home/jalonia/.ssh
sudo -u jalonia -H ssh-keygen -t ed25519 -N "" -C "jalonia-vps" -f /home/jalonia/.ssh/id_ed25519
cat /home/jalonia/.ssh/id_ed25519.pub
```

Copiez la ligne affichée (elle commence par `ssh-ed25519`). Sur GitHub : dépôt **jalonia-saas** →
**Settings** → **Deploy keys** → **Add deploy key** → titre `VPS Jalonia`, collez la clé, **ne cochez pas**
« Allow write access » → **Add key**.

Puis, sur le serveur :

```bash
sudo -u jalonia -H ssh -o StrictHostKeyChecking=accept-new -T git@github.com
sudo -u jalonia -H git clone git@github.com:ossongombia-create/jalonia-saas.git /opt/jalonia/depot
```

La première commande doit répondre « …successfully authenticated… » (elle se termine volontairement par
un code d'erreur : c'est normal). La seconde télécharge le code.

## Étape 7 — Base de données et fichiers de configuration

Copiez-collez **tout le bloc en une fois** (les variables ne vivent que le temps de ce bloc). Chaque fichier
reçoit ses droits **avant** d'être rempli :

- `/etc/jalonia/jalonia.env` : configuration de l'application, lisible **par root seulement** (systemd la
  lit et la transmet au service). Elle ne contient **pas** le mot de passe du rôle propriétaire ;
- `/etc/jalonia/proprietaire.env` : mot de passe du rôle propriétaire de la base, lisible par root et par
  le compte **jalonia** (migrations, création d'un superadmin), jamais par **jalonia-run**.

```bash
cd /tmp
MDP_PROPRIETAIRE=$(openssl rand -hex 24)
MDP_APP=$(openssl rand -hex 24)
SECRET=$(openssl rand -base64 48 | tr -d '\n')
CLE_MFA=$(openssl rand -base64 32)
mkdir -p /etc/jalonia
: > /etc/jalonia/jalonia.env && chown root:root /etc/jalonia/jalonia.env && chmod 600 /etc/jalonia/jalonia.env
cat > /etc/jalonia/jalonia.env <<EOF
DATABASE_URL=postgresql://jalonia_app:${MDP_APP}@127.0.0.1:5432/jalonia
AUTH_SECRET=${SECRET}
AUTH_URL=https://jalonia.mosa-apps.com
AUTH_TRUST_HOST=true
SESSION_INACTIVITE_MINUTES=120
SESSION_DUREE_HEURES=8
FUSEAU_HORAIRE=UTC
CLE_SECOND_FACTEUR=${CLE_MFA}
EOF
: > /etc/jalonia/proprietaire.env && chown root:jalonia /etc/jalonia/proprietaire.env && chmod 640 /etc/jalonia/proprietaire.env
cat > /etc/jalonia/proprietaire.env <<EOF
DATABASE_URL_PROPRIETAIRE=postgresql://jalonia_owner:${MDP_PROPRIETAIRE}@127.0.0.1:5432/jalonia
EOF
sudo -u postgres psql -v ON_ERROR_STOP=1 -v nom_base=jalonia -v mdp_proprietaire="$MDP_PROPRIETAIRE" -v mdp_app="$MDP_APP" < /opt/jalonia/depot/deploy/preparer-base.sql
unset MDP_PROPRIETAIRE MDP_APP SECRET CLE_MFA
ls -l /etc/jalonia
```

`CLE_SECOND_FACTEUR` chiffre les seconds facteurs des comptes (codes à 6 chiffres) : **gardez une copie de
`/etc/jalonia/jalonia.env` en lieu sûr**, hors du serveur. Sans cette clé, chaque second facteur devrait être
réinitialisé.

Le message « Base prête. » doit apparaître, puis les deux fichiers :
`-rw------- 1 root root … jalonia.env` et `-rw-r----- 1 root jalonia … proprietaire.env`.

**Fuseau horaire des dates affichées** : remplacez `UTC` par le vôtre (ex. `Africa/Libreville`,
`Africa/Douala`, `Europe/Paris`) avec :

```bash
nano /etc/jalonia/jalonia.env
```

(modifiez la ligne `FUSEAU_HORAIRE=`, puis Ctrl+O, Entrée, Ctrl+X).

## Étape 8 — Service de l'application et script de déploiement

```bash
cp /opt/jalonia/depot/deploy/jalonia.service /etc/systemd/system/jalonia.service
systemctl daemon-reload
systemctl enable jalonia
install -o root -g root -m 750 /opt/jalonia/depot/deploy/deployer.sh /usr/local/sbin/jalonia-deployer
```

La dernière ligne installe **la copie de root** du script de déploiement : root n'exécute jamais un script
qu'un autre compte pourrait modifier. Quand une nouvelle version de Jalonia change ce script,
`jalonia-deployer` s'arrête avant de construire et affiche les commandes à taper (voir « Au quotidien »).

## Étape 9 — HTTPS (Caddy)

Caddy doit être seul sur les ports 80 et 443. Si un autre serveur web est installé (nginx, Apache), il
répondrait à sa place (erreur 404) : on le désactive d'abord.

```bash
ss -ltnp | grep -E ':(80|443) '
systemctl disable --now nginx apache2 2>/dev/null; true
cp /opt/jalonia/depot/deploy/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
systemctl is-active caddy
```

`caddy validate` doit se terminer par « Valid configuration », et `systemctl is-active caddy` répondre `active`.

## Étape 10 — Premier déploiement

```bash
jalonia-deployer
```

Compter 5 à 10 minutes (installation des dépendances et construction). Attendus : « ✔ Jalonia … est en
service. », puis les contrôles de sécurité, tous marqués ✔, et « ✔ Tous les contrôles sont satisfaits. ».

## Étape 11 — Créer votre compte superadministrateur

```bash
cd "$(readlink -f /opt/jalonia/courant)/../.."
sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/creer-superadmin.ts
cd /root
```

Saisissez votre e-mail, votre nom, puis deux fois le mot de passe (rien ne s'affiche pendant la saisie :
c'est normal). 12 caractères minimum.

## Étape 12 — Vérifications

```bash
curl -s http://127.0.0.1:3000/api/sante
curl -sI https://jalonia.mosa-apps.com/connexion | head -1
systemctl status jalonia --no-pager | head -5
jalonia-deployer --verifier
```

Attendus : `{"etat":"ok"}`, puis `HTTP/2 200`, puis `active (running)`, puis « ✔ Tous les contrôles sont
satisfaits. ».
Ouvrez **https://jalonia.mosa-apps.com** et connectez-vous. **Second facteur obligatoire pour un superadmin** :
à la première connexion, Jalonia montre un code QR à scanner avec une application d'authentification (Google
Authenticator, Microsoft Authenticator, FreeOTP…), puis 10 codes de secours à noter et ranger hors du téléphone.

## Étape 13 — Sauvegarde quotidienne

```bash
install -m 755 /opt/jalonia/depot/deploy/sauvegarde.sh /etc/cron.daily/jalonia-sauvegarde
/etc/cron.daily/jalonia-sauvegarde && ls -l /var/backups/jalonia
```

Une sauvegarde par jour, 14 jours conservés, dans `/var/backups/jalonia`, avec chaque jour un petit fichier
`ancres-AAAA-MM-JJ.txt` : la dernière empreinte de chaque journal d'audit. Pensez à copier régulièrement les
sauvegardes **et les fichiers d'ancres hors du VPS** (par exemple en vous les envoyant par e-mail) : une ancre
gardée ailleurs prouve plus tard qu'aucune ligne antérieure du journal n'a été retouchée, même par quelqu'un
qui aurait tous les droits sur la base.

## Étape 14 — Tâches quotidiennes (rappels de revue)

Chaque jour vers 6 h, Jalonia prévient les approbateurs des revues de documents à faire ou en retard, et les
administrateurs des retards qui durent (réglages : page « Paramètres » de chaque organisation). Les tâches tournent
sous le compte du service web, avec ses seuls droits.

```bash
install -m 644 /opt/jalonia/depot/deploy/jalonia-taches.service /etc/systemd/system/jalonia-taches.service
install -m 644 /opt/jalonia/depot/deploy/jalonia-taches.timer /etc/systemd/system/jalonia-taches.timer
systemctl daemon-reload && systemctl enable --now jalonia-taches.timer
systemctl start jalonia-taches.service && journalctl -u jalonia-taches -n 5 --no-pager
```

Attendu : une ligne `{"evenement":"taches_quotidiennes",…,"erreurs":[]}`. `systemctl list-timers jalonia-taches`
indique le prochain passage.

---

## Au quotidien

| Besoin | Commande (en root) |
|---|---|
| Mettre à jour vers la dernière version | `jalonia-deployer` |
| Vérifier la sécurité de l'installation | `jalonia-deployer --verifier` |
| Voir les journaux de l'application | `journalctl -u jalonia -f` (Ctrl+C pour quitter) |
| Voir le dernier passage des tâches quotidiennes | `journalctl -u jalonia-taches -n 5 --no-pager` |
| Redémarrer l'application | `systemctl restart jalonia` |
| Créer un autre superadmin, ou retrouver l'accès | refaire l'étape 11 (un compte existant est promu et reçoit le nouveau mot de passe) |
| Vérifier que les journaux d'audit n'ont pas été retouchés | voir « Vérifier les journaux » ci-dessous |
| Superadmin : téléphone perdu **et** plus de codes de secours | voir « Retirer le second facteur d'un superadmin » ci-dessous |
| Autre compte : téléphone perdu | dans Jalonia, superadmin → Utilisateurs → la personne → « Retirer le second facteur » |

Si une mise à jour ne démarre pas, le script **revient tout seul** à la version précédente et affiche
les dernières lignes du journal.

**« Le script de déploiement a changé dans cette version »** : `jalonia-deployer` s'est arrêté avant de
construire ; la version en service n'a pas changé. Relisez la différence, installez la nouvelle copie, puis
relancez (le script affiche ces trois commandes) :

```bash
diff -u /usr/local/sbin/jalonia-deployer /opt/jalonia/depot/deploy/deployer.sh
install -o root -g root -m 750 /opt/jalonia/depot/deploy/deployer.sh /usr/local/sbin/jalonia-deployer
jalonia-deployer
```

**Vérifier les journaux** (chaîne d'empreintes recalculée depuis le début ; avec les ancres, contrôle en plus
qu'aucune ligne antérieure à chaque ancre n'a changé) :

```bash
cd "$(readlink -f /opt/jalonia/courant)/../.."
sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/verifier-journal.ts --ancres /var/backups/jalonia/ancres-*.txt
cd /root
```

Attendu : une ligne ✔ par journal, puis « ✔ … journal(aux) intact(s). ». Pour une ancre gardée hors du serveur,
copiez-la d'abord sur le serveur et donnez son chemin après `--ancres`. Une ligne ✘ désigne le journal et le rang
en cause : ne touchez à rien et prévenez la personne chargée de la sécurité.

**Retirer le second facteur d'un superadmin** (il en activera un nouveau à sa prochaine connexion ; ses
sessions sont fermées ; tracé dans les journaux) :

```bash
cd "$(readlink -f /opt/jalonia/courant)/../.."
sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/reinitialiser-second-facteur.ts
cd /root
```

Saisissez l'e-mail du compte, puis `oui`.

## Second facteur sur une installation existante (une fois)

Pour une installation faite avant l'arrivée du second facteur : `/etc/jalonia/jalonia.env` ne contient pas encore
`CLE_SECOND_FACTEUR`. Ajoutez-la **avant ou juste après** la mise à jour (sans elle, les superadmins ne peuvent
plus entrer dans l'interface : le second facteur leur est obligatoire) :

```bash
grep -q '^CLE_SECOND_FACTEUR=' /etc/jalonia/jalonia.env || echo "CLE_SECOND_FACTEUR=$(openssl rand -base64 32)" >> /etc/jalonia/jalonia.env
grep -c '^CLE_SECOND_FACTEUR=' /etc/jalonia/jalonia.env
systemctl restart jalonia
```

Attendu : `1`. La ligne n'est ajoutée qu'une fois, même si le bloc est recollé. **Gardez une copie de
`/etc/jalonia/jalonia.env` en lieu sûr**, hors du serveur : sans cette clé, chaque second facteur devrait être
réinitialisé. À votre prochaine connexion, Jalonia vous demandera d'activer le vôtre (code QR, puis codes de
secours à noter).

## Ancres des journaux sur une installation existante (une fois)

La sauvegarde quotidienne écrit désormais les ancres des journaux. Réinstallez sa copie (après la mise à jour) :

```bash
install -m 755 /opt/jalonia/depot/deploy/sauvegarde.sh /etc/cron.daily/jalonia-sauvegarde
/etc/cron.daily/jalonia-sauvegarde && ls -l /var/backups/jalonia | tail -3
```

Attendu : un fichier `ancres-AAAA-MM-JJ.txt` du jour.

## Tâches quotidiennes sur une installation existante (une fois)

Après la mise à jour qui apporte les revues périodiques, installez le minuteur : mêmes commandes qu'à l'étape 14.
`jalonia-deployer --verifier` signale ensuite si le minuteur n'est pas actif, ou si les fichiers installés ne sont
plus ceux du dépôt (dans ce cas, relisez la différence avec `diff -u`, puis réinstallez-les).

## Durcissement d'une installation existante (une fois)

Pour une installation faite avec les instructions précédentes : l'application tourne sous le compte
`jalonia`, qui possède aussi son code, et `/etc/jalonia/jalonia.env` contient le mot de passe du rôle
propriétaire. On la reconnaît ainsi : `systemctl show -p User --value jalonia` répond `jalonia` (et non
`jalonia-run`). Après ce durcissement :

- l'application tourne sous **jalonia-run**, qui ne peut modifier ni le code, ni le script de déploiement,
  ni lire `/etc/jalonia` ;
- le mot de passe du rôle propriétaire n'est plus transmis à l'application ;
- root lance le déploiement depuis sa propre copie du script (`jalonia-deployer`).

Durée : 15 minutes, dont 5 à 10 de construction. L'application reste en service, sauf pendant ses
redémarrages (quelques secondes). Tapez les blocs **dans l'ordre**, en root.

**1. Déployer la nouvelle version** (avec la commande habituelle, une dernière fois) :

```bash
bash /opt/jalonia/depot/deploy/deployer.sh
```

Attendu : « ✔ Jalonia … est en service. ». Si des contrôles marqués ✘ s'affichent ensuite, c'est normal à
ce stade : les blocs suivants les corrigent.

**2. Créer le compte de l'application et garder une copie de l'existant** (pour revenir en arrière) :

```bash
id jalonia-run >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin jalonia-run
install -d -m 700 /root/avant-durcissement
[ -e /root/avant-durcissement/jalonia.env ] || cp -p /etc/jalonia/jalonia.env /etc/systemd/system/jalonia.service /root/avant-durcissement/
id jalonia-run
ls -l /root/avant-durcissement
```

Attendus : une ligne `uid=… (jalonia-run)…`, puis les deux copies `jalonia.env` et `jalonia.service`.

**3. Séparer le mot de passe du rôle propriétaire** dans son propre fichier :

```bash
cd /etc/jalonia
: > proprietaire.env.nouveau && chown root:jalonia proprietaire.env.nouveau && chmod 640 proprietaire.env.nouveau
grep '^DATABASE_URL_PROPRIETAIRE=' jalonia.env > proprietaire.env.nouveau
: > jalonia.env.nouveau && chown root:root jalonia.env.nouveau && chmod 600 jalonia.env.nouveau
grep -v '^DATABASE_URL_PROPRIETAIRE=' jalonia.env > jalonia.env.nouveau
if [ "$(grep -c '^DATABASE_URL_PROPRIETAIRE=' proprietaire.env.nouveau)" = 1 ] && [ "$(grep -c '' proprietaire.env.nouveau)" = 1 ] && grep -q '^DATABASE_URL=' jalonia.env.nouveau && ! grep -q 'DATABASE_URL_PROPRIETAIRE' jalonia.env.nouveau; then mv proprietaire.env.nouveau proprietaire.env && mv jalonia.env.nouveau jalonia.env && echo "OK : fichiers séparés"; else rm -f proprietaire.env.nouveau jalonia.env.nouveau; echo "STOP : contenu inattendu, rien n'a été modifié (déjà fait ? vérifiez avec : ls -l /etc/jalonia)"; fi
ls -l /etc/jalonia
cd /root
```

Attendus : « OK : fichiers séparés », puis `-rw------- 1 root root … jalonia.env` et
`-rw-r----- 1 root jalonia … proprietaire.env`. **Si « STOP » s'affiche, n'allez pas plus loin.**

**4. Installer le nouveau service et la copie de root du script de déploiement** :

```bash
cp /opt/jalonia/depot/deploy/jalonia.service /etc/systemd/system/jalonia.service
systemctl daemon-reload
systemctl restart jalonia
install -o root -g root -m 750 /opt/jalonia/depot/deploy/deployer.sh /usr/local/sbin/jalonia-deployer
sleep 10
curl -s http://127.0.0.1:3000/api/sante
```

Attendu : `{"etat":"ok"}` (si la réponse est vide, attendez quelques secondes et relancez la dernière
ligne ; si elle reste vide, appliquez le retour arrière ci-dessous).

**5. Vérifier** :

```bash
jalonia-deployer --verifier
```

Attendu : dix lignes ✔, puis « ✔ Tous les contrôles sont satisfaits. » (si la ligne de la clé du second facteur
est ✘, appliquez d'abord la section « Second facteur sur une installation existante »). Ouvrez ensuite
**https://jalonia.mosa-apps.com** et connectez-vous.

Désormais, pour mettre à jour : **`jalonia-deployer`** (l'ancienne commande est refusée et l'indique).
Après quelques jours sans problème, supprimez les copies de sauvegarde (elles contiennent le mot de passe
du rôle propriétaire) : `rm -r /root/avant-durcissement`.

**6. En cas de problème : retour arrière** (remet le service et le fichier de configuration d'avant) :

```bash
cp -p /root/avant-durcissement/jalonia.service /etc/systemd/system/jalonia.service
cp -p /root/avant-durcissement/jalonia.env /etc/jalonia/jalonia.env
systemctl daemon-reload
systemctl restart jalonia
sleep 10
curl -s http://127.0.0.1:3000/api/sante
```

Attendu : `{"etat":"ok"}`. Les mises à jour se font toujours avec `jalonia-deployer` (il signale alors
les contrôles non satisfaits, sans bloquer).

## Restaurer une sauvegarde (en cas de besoin)

```bash
systemctl stop jalonia
cd /tmp
sudo -u postgres psql -q < /var/backups/jalonia/roles-AAAA-MM-JJ.sql
sudo -u postgres dropdb jalonia
sudo -u postgres pg_restore --create -d postgres < /var/backups/jalonia/jalonia-AAAA-MM-JJ.dump
systemctl start jalonia
```

Remplacez `AAAA-MM-JJ` par la date voulue. Les messages « role … already exists » sont sans gravité.
