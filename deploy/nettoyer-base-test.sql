-- =====================================================================================================
-- Jalonia — REMISE À ZÉRO de la base avant une phase de test utilisateur.
--
-- GARDE   : le compte superadmin dont l'adresse est passée en variable (:superadmin), avec son mot de passe,
--           son second facteur et ses codes de secours ; la structure (migrations, gabarits d'organisation) ;
--           le réglage du mode maintenance.
-- SUPPRIME: toutes les organisations (schéma dédié : documents, versions, actions, indicateurs, notifications,
--           journal de l'organisation ; rôle PostgreSQL dédié ; adhésions, invitations, accès d'urgence) ;
--           tous les autres comptes (y compris d'autres superadmins) ; toutes les sessions ; les tentatives de
--           connexion ; les liens de réinitialisation.
-- VIDE    : le journal de la plateforme (en ajout seul et chaîné : ses déclencheurs de protection sont
--           suspendus le temps de cette transaction, puis rétablis ; la chaîne repart du rang 1).
--
-- TOUT OU RIEN : une seule transaction ; la moindre erreur annule tout. Le script s'arrête AVANT de toucher à
-- quoi que ce soit si l'adresse ne correspond pas à exactement UN compte superadmin actif.
--
-- Usage (sur le serveur, application arrêtée) :
--   sudo -u postgres psql -d jalonia -v ON_ERROR_STOP=1 -v superadmin='vous@exemple.com' -f nettoyer-base-test.sql
-- =====================================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- Messages : avertissements et erreurs seulement (pas le détail des objets supprimés en cascade).
SET LOCAL client_min_messages = warning;

-- Aucune écriture concurrente pendant le nettoyage (application, tâches quotidiennes).
LOCK TABLE platform.organisations, platform.utilisateurs, platform.journal IN ACCESS EXCLUSIVE MODE;

-- ----- 0. Garde-fou : le compte à garder existe, est superadmin et actif -----
SELECT set_config('jalonia.superadmin', lower(trim(:'superadmin')), true);
DO $garde$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM platform.utilisateurs
   WHERE email = current_setting('jalonia.superadmin') AND est_superadmin AND statut = 'actif';
  IF n <> 1 THEN
    RAISE EXCEPTION 'ARRÊT : aucun compte superadmin actif avec l''adresse « % ». Rien n''a été modifié.',
      current_setting('jalonia.superadmin');
  END IF;
END
$garde$;

\echo '--- AVANT ---'
SELECT (SELECT count(*) FROM platform.organisations) AS organisations,
       (SELECT count(*) FROM platform.utilisateurs)  AS utilisateurs,
       (SELECT count(*) FROM platform.journal)       AS lignes_journal;
\echo '--- Organisations qui vont être supprimées ---'
SELECT slug, nom, schema_name FROM platform.organisations ORDER BY slug;

-- ----- 1. Organisations : lignes communes, puis schéma et rôle dédiés -----
-- (Même méthode que la fin de contrat, src/server/fin-de-contrat/service.ts.) Les adhésions, invitations et accès
-- d'urgence suivent par ON DELETE CASCADE ; les sessions perdent leur organisation par ON DELETE SET NULL.
-- DROP ROLE retire aussi l'adhésion de jalonia_app au rôle de l'organisation.
DO $organisations$
DECLARE
  o record;
BEGIN
  FOR o IN SELECT id, slug, schema_name, role_name FROM platform.organisations ORDER BY slug LOOP
    -- Noms vérifiés AVANT tout SQL dynamique (format imposé par platform.provisionner_organisation).
    IF o.schema_name !~ '^org_[0-9a-f]{12}$' OR o.role_name <> o.schema_name || '_rw' THEN
      RAISE EXCEPTION 'Nom de schéma ou de rôle inattendu pour « % » : arrêt, rien n''a été modifié.', o.slug;
    END IF;
    DELETE FROM platform.migrations_organisation WHERE schema_name = o.schema_name;
    DELETE FROM platform.organisations WHERE id = o.id;
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', o.schema_name);
    EXECUTE format('DROP ROLE IF EXISTS %I', o.role_name);
  END LOOP;
END
$organisations$;

-- ----- 2. Comptes : tous sauf le superadmin gardé -----
-- Sessions, codes de secours et liens de réinitialisation des comptes supprimés suivent par ON DELETE CASCADE.
DELETE FROM platform.utilisateurs WHERE email <> current_setting('jalonia.superadmin');

-- ----- 3. Données techniques de test -----
DELETE FROM platform.sessions;               -- toutes, y compris celles du superadmin (il se reconnecte)
DELETE FROM platform.tentatives_connexion;   -- compteurs de connexion (limiteur)
DELETE FROM platform.reinitialisations;      -- liens de réinitialisation de mot de passe
DELETE FROM platform.invitations;            -- (déjà vide après l'étape 1 : par sûreté)
DELETE FROM platform.acces_urgence;          -- (idem)

-- Le superadmin gardé : verrouillage et compteurs d'échecs remis à zéro.
UPDATE platform.utilisateurs SET verrouille_jusqua = NULL, echecs_mfa = 0
 WHERE email = current_setting('jalonia.superadmin');

-- ----- 4. Journal de la plateforme : vidé, chaîne remise au rang 1 -----
ALTER TABLE platform.journal DISABLE TRIGGER journal_ajout_seul;
ALTER TABLE platform.journal DISABLE TRIGGER journal_pas_de_vidage;
TRUNCATE platform.journal RESTART IDENTITY;
ALTER TABLE platform.journal ENABLE TRIGGER journal_ajout_seul;
ALTER TABLE platform.journal ENABLE TRIGGER journal_pas_de_vidage;

-- ----- 5. Contrôle final, AVANT validation : sinon tout est annulé -----
DO $controle$
BEGIN
  IF (SELECT count(*) FROM platform.organisations) <> 0
     OR (SELECT count(*) FROM platform.utilisateurs) <> 1
     OR NOT EXISTS (SELECT 1 FROM platform.utilisateurs WHERE email = current_setting('jalonia.superadmin') AND est_superadmin)
     OR (SELECT count(*) FROM platform.adhesions) <> 0
     OR (SELECT count(*) FROM platform.migrations_organisation) <> 0
     OR (SELECT count(*) FROM platform.journal) <> 0
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname ~ '^org_[0-9a-f]{12}$')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname ~ '^org_[0-9a-f]{12}_rw$') THEN
    RAISE EXCEPTION 'Contrôle final en échec : tout est annulé.';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'platform.journal'::regclass AND tgenabled = 'O'
        AND tgname IN ('journal_ajout_seul', 'journal_pas_de_vidage', 'journal_chainage')) <> 3 THEN
    RAISE EXCEPTION 'Protections du journal non rétablies : tout est annulé.';
  END IF;
END
$controle$;

\echo '--- APRÈS ---'
SELECT (SELECT count(*) FROM platform.organisations) AS organisations,
       (SELECT count(*) FROM platform.utilisateurs)  AS utilisateurs,
       (SELECT count(*) FROM platform.journal)       AS lignes_journal;

COMMIT;
\echo 'Nettoyage terminé.'
