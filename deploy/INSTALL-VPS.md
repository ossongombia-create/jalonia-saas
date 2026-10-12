# Installer Jalonia sur le VPS (Ubuntu 26.04)

Serveur : Vultr, 1 Go de mémoire, IP **155.138.146.14**. Adresse finale : **https://jalonia.mosa-apps.com**.

Durée : environ 30 minutes. Chaque bloc se copie-colle **tel quel**, dans l'ordre, dans une session SSH
connectée en **root**. Si vous êtes connecté avec un autre utilisateur, tapez d'abord `sudo -i`.

> **Si un collage affiche `^[[200~` au début de la commande** (« command not found ») : le terminal ne gère
> pas le « collage encadré ». Tapez **au clavier** `bind 'set enable-bracketed-paste off'`, puis, pour que
> ce soit permanent : `echo 'set enable-bracketed-paste off' >> ~/.inputrc`.

> Aucune valeur secrète n'est à recopier à la main : les mots de passe de la base et le secret des sessions
> sont générés sur le serveur et ne quittent jamais le fichier `/etc/jalonia/jalonia.env`.

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

## Étape 5 — Utilisateur système et dossiers

```bash
useradd --system --create-home --home-dir /home/jalonia --shell /usr/sbin/nologin jalonia
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

## Étape 7 — Base de données et fichier de configuration

Copiez-collez **tout le bloc en une fois** (les variables ne vivent que le temps de ce bloc) :

```bash
cd /tmp
MDP_PROPRIETAIRE=$(openssl rand -hex 24)
MDP_APP=$(openssl rand -hex 24)
SECRET=$(openssl rand -base64 48 | tr -d '\n')
mkdir -p /etc/jalonia
cat > /etc/jalonia/jalonia.env <<EOF
DATABASE_URL=postgresql://jalonia_app:${MDP_APP}@127.0.0.1:5432/jalonia
DATABASE_URL_PROPRIETAIRE=postgresql://jalonia_owner:${MDP_PROPRIETAIRE}@127.0.0.1:5432/jalonia
AUTH_SECRET=${SECRET}
AUTH_URL=https://jalonia.mosa-apps.com
AUTH_TRUST_HOST=true
SESSION_INACTIVITE_MINUTES=120
SESSION_DUREE_HEURES=8
FUSEAU_HORAIRE=UTC
EOF
chown root:jalonia /etc/jalonia/jalonia.env
chmod 640 /etc/jalonia/jalonia.env
sudo -u postgres psql -v ON_ERROR_STOP=1 -v nom_base=jalonia -v mdp_proprietaire="$MDP_PROPRIETAIRE" -v mdp_app="$MDP_APP" < /opt/jalonia/depot/deploy/preparer-base.sql
unset MDP_PROPRIETAIRE MDP_APP SECRET
```

Le dernier message doit être « Base prête. ».

**Fuseau horaire des dates affichées** : remplacez `UTC` par le vôtre (ex. `Africa/Libreville`,
`Africa/Douala`, `Europe/Paris`) avec :

```bash
nano /etc/jalonia/jalonia.env
```

(modifiez la ligne `FUSEAU_HORAIRE=`, puis Ctrl+O, Entrée, Ctrl+X).

## Étape 8 — Service de l'application

```bash
cp /opt/jalonia/depot/deploy/jalonia.service /etc/systemd/system/jalonia.service
systemctl daemon-reload
systemctl enable jalonia
```

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
bash /opt/jalonia/depot/deploy/deployer.sh
```

Compter 5 à 10 minutes (installation des dépendances et construction). La dernière ligne doit être
« ✔ Jalonia … est en service. ».

## Étape 11 — Créer votre compte superadministrateur

```bash
cd "$(readlink -f /opt/jalonia/courant)/../.."
sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/jalonia.env scripts/creer-superadmin.ts
cd /root
```

Saisissez votre e-mail, votre nom, puis deux fois le mot de passe (rien ne s'affiche pendant la saisie :
c'est normal). 12 caractères minimum.

## Étape 12 — Vérifications

```bash
curl -s http://127.0.0.1:3000/api/sante
curl -sI https://jalonia.mosa-apps.com/connexion | head -1
systemctl status jalonia --no-pager | head -5
```

Attendus : `{"etat":"ok"}`, puis `HTTP/2 200`, puis `active (running)`.
Ouvrez **https://jalonia.mosa-apps.com** et connectez-vous.

## Étape 13 — Sauvegarde quotidienne

```bash
install -m 755 /opt/jalonia/depot/deploy/sauvegarde.sh /etc/cron.daily/jalonia-sauvegarde
/etc/cron.daily/jalonia-sauvegarde && ls -l /var/backups/jalonia
```

Une sauvegarde par jour, 14 jours conservés, dans `/var/backups/jalonia`. Pensez à en copier
régulièrement une **hors du VPS**.

---

## Au quotidien

| Besoin | Commande (en root) |
|---|---|
| Mettre à jour vers la dernière version | `bash /opt/jalonia/depot/deploy/deployer.sh` |
| Voir les journaux de l'application | `journalctl -u jalonia -f` (Ctrl+C pour quitter) |
| Redémarrer l'application | `systemctl restart jalonia` |
| Créer un autre superadmin, ou retrouver l'accès | refaire l'étape 11 (un compte existant est promu et reçoit le nouveau mot de passe) |

Si une mise à jour ne démarre pas, le script **revient tout seul** à la version précédente et affiche
les dernières lignes du journal.

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
