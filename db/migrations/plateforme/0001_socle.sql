-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0001 : le socle du plan de contrôle.
--
-- Exécutée par le rôle propriétaire (jalonia_owner), dans une transaction, avec search_path = '' :
-- tous les noms sont donc écrits en entier (platform.xxx). Le lanceur a déjà créé le schéma
-- « platform » et ses tables de suivi des migrations.
--
-- Rôles PostgreSQL (créés à l'installation, voir deploy/preparer-base.sql) :
--   jalonia_owner : propriétaire des objets ; migrations et création d'organisations uniquement.
--   jalonia_app   : rôle de l'application ; droits limités, accordés ci-dessous table par table,
--                   et souvent COLONNE par colonne.
-- =====================================================================================================

-- Personne d'autre que le propriétaire ne crée d'objets dans « public » ni dans « platform ».
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO jalonia_app;

-- -----------------------------------------------------------------------------------------------------
-- Organisations (les « tenants »). Chacune a SON schéma PostgreSQL et SON rôle PostgreSQL.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE platform.organisations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         text NOT NULL CHECK (char_length(nom) BETWEEN 2 AND 200),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  schema_name text NOT NULL UNIQUE CHECK (schema_name ~ '^org_[0-9a-f]{12}$'),
  role_name   text NOT NULL UNIQUE CHECK (role_name ~ '^org_[0-9a-f]{12}_rw$'),
  statut      text NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'suspendue')),
  cree_le     timestamptz NOT NULL DEFAULT now(),
  cree_par    uuid NULL,
  CONSTRAINT organisations_role_du_schema CHECK (role_name = schema_name || '_rw')
);

-- -----------------------------------------------------------------------------------------------------
-- Utilisateurs (identités communes à toute la plateforme ; une personne peut appartenir à plusieurs
-- organisations). Le drapeau est_superadmin = rôle SUPERADMIN_PLATFORM.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE platform.utilisateurs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE
                       CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
  nom                text NOT NULL CHECK (char_length(nom) BETWEEN 1 AND 200),
  mot_de_passe_hash  text NOT NULL CHECK (mot_de_passe_hash LIKE '$argon2id$%'),
  est_superadmin     boolean NOT NULL DEFAULT false,
  statut             text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'desactive')),
  doit_changer_mdp   boolean NOT NULL DEFAULT true,
  langue             text NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'en')),
  echecs_connexion   integer NOT NULL DEFAULT 0 CHECK (echecs_connexion >= 0),
  verrouille_jusqua  timestamptz NULL,
  derniere_connexion timestamptz NULL,
  cree_le            timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------------------------------
-- Adhésions : qui appartient à quelle organisation, avec quels rôles.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE platform.adhesions (
  utilisateur_id  uuid NOT NULL REFERENCES platform.utilisateurs (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES platform.organisations (id) ON DELETE CASCADE,
  roles           text[] NOT NULL CHECK (
                    cardinality(roles) BETWEEN 1 AND 5
                    AND roles <@ ARRAY['ADMIN_ORGANISATION', 'REDACTEUR', 'VERIFICATEUR', 'APPROBATEUR', 'LECTEUR']::text[]
                  ),
  cree_le         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, organisation_id)
);
CREATE INDEX adhesions_organisation_idx ON platform.adhesions (organisation_id);

-- -----------------------------------------------------------------------------------------------------
-- Sessions : une ligne par connexion. Sert au suivi (durée, adresse IP, navigateur) et à la RÉVOCATION :
-- l'application vérifie cette ligne à chaque requête.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE platform.sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id    uuid NOT NULL REFERENCES platform.utilisateurs (id) ON DELETE CASCADE,
  organisation_id   uuid NULL REFERENCES platform.organisations (id) ON DELETE SET NULL,
  debut             timestamptz NOT NULL DEFAULT now(),
  derniere_activite timestamptz NOT NULL DEFAULT now(),
  fin               timestamptz NULL,
  motif_fin         text NULL CHECK (motif_fin IN ('deconnexion', 'expiration', 'revocation')),
  ip                inet NULL,
  agent             text NULL CHECK (char_length(agent) <= 500),
  CONSTRAINT sessions_fin_et_motif CHECK ((fin IS NULL) = (motif_fin IS NULL))
);
CREATE INDEX sessions_utilisateur_idx ON platform.sessions (utilisateur_id, debut DESC);
CREATE INDEX sessions_ouvertes_idx ON platform.sessions (derniere_activite DESC) WHERE fin IS NULL;

-- -----------------------------------------------------------------------------------------------------
-- Journal d'audit de la PLATEFORME : en AJOUT SEUL. Pas de clé étrangère : le journal doit survivre à
-- la suppression de ce qu'il décrit.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE platform.journal (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  horodatage      timestamptz NOT NULL DEFAULT now(),
  acteur_id       uuid NULL,
  acteur_email    text NULL,
  organisation_id uuid NULL,
  action          text NOT NULL CHECK (action ~ '^[A-Z][A-Z_]{1,63}$'),
  cible_type      text NULL,
  cible_id        text NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip              inet NULL,
  agent           text NULL
);
CREATE INDEX journal_horodatage_idx ON platform.journal (horodatage DESC);
CREATE INDEX journal_organisation_idx ON platform.journal (organisation_id, horodatage DESC);
CREATE INDEX journal_acteur_idx ON platform.journal (acteur_id, horodatage DESC);

CREATE FUNCTION platform.refuser_modification_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul : % interdit.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER journal_ajout_seul
  BEFORE UPDATE OR DELETE ON platform.journal
  FOR EACH ROW EXECUTE FUNCTION platform.refuser_modification_journal();
CREATE TRIGGER journal_pas_de_vidage
  BEFORE TRUNCATE ON platform.journal
  FOR EACH STATEMENT EXECUTE FUNCTION platform.refuser_modification_journal();

-- -----------------------------------------------------------------------------------------------------
-- Droits du rôle applicatif. Principe : le strict nécessaire, colonne par colonne.
--  - L'application ne CRÉE PAS d'organisations (c'est le rôle propriétaire) : elle peut seulement
--    les lire et changer leur statut (suspendre / réactiver).
--  - Elle ne peut NI créer NI promouvoir un superadmin : la colonne est_superadmin n'est accessible
--    qu'en lecture.
--  - Le journal : lecture et ajout seulement.
-- -----------------------------------------------------------------------------------------------------
GRANT SELECT ON platform.organisations TO jalonia_app;
GRANT UPDATE (statut) ON platform.organisations TO jalonia_app;

GRANT SELECT ON platform.utilisateurs TO jalonia_app;
GRANT INSERT (email, nom, mot_de_passe_hash, doit_changer_mdp, langue) ON platform.utilisateurs TO jalonia_app;
GRANT UPDATE (nom, mot_de_passe_hash, statut, doit_changer_mdp, langue, echecs_connexion, verrouille_jusqua, derniere_connexion)
  ON platform.utilisateurs TO jalonia_app;

GRANT SELECT, DELETE ON platform.adhesions TO jalonia_app;
GRANT INSERT (utilisateur_id, organisation_id, roles) ON platform.adhesions TO jalonia_app;
GRANT UPDATE (roles) ON platform.adhesions TO jalonia_app;

GRANT SELECT ON platform.sessions TO jalonia_app;
GRANT INSERT (utilisateur_id, organisation_id, ip, agent) ON platform.sessions TO jalonia_app;
GRANT UPDATE (organisation_id, derniere_activite, fin, motif_fin) ON platform.sessions TO jalonia_app;

GRANT SELECT, INSERT ON platform.journal TO jalonia_app;
