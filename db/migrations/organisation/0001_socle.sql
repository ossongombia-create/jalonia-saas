-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0001 : le socle du schéma propre à chaque organisation.
--
-- Ce fichier est un GABARIT appliqué à chaque organisation. Le lanceur remplace :
--   {{schema}} par le schéma de l'organisation   (ex. "org_3f9a0c1b2d4e")
--   {{role}}   par le rôle PostgreSQL dédié       (ex. "org_3f9a0c1b2d4e_rw")
-- Ces identifiants sont générés par l'application et validés par expression régulière avant tout
-- remplacement (voir src/server/db/identifiants.ts).
--
-- ÉTANCHÉITÉ : le rôle {{role}} n'a de droits QUE sur ce schéma. L'application exécute chaque requête
-- d'une organisation avec « SET LOCAL ROLE {{role}} » : même une requête erronée qui viserait le schéma
-- d'une autre organisation est refusée par PostgreSQL.
-- =====================================================================================================

REVOKE ALL ON SCHEMA {{schema}} FROM PUBLIC;
GRANT USAGE ON SCHEMA {{schema}} TO {{role}};

-- Journal d'audit de l'organisation : en AJOUT SEUL (mêmes règles que le journal de la plateforme).
CREATE TABLE {{schema}}.journal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  horodatage   timestamptz NOT NULL DEFAULT now(),
  acteur_id    uuid NULL,
  acteur_email text NULL,
  action       text NOT NULL CHECK (action ~ '^[A-Z][A-Z_]{1,63}$'),
  cible_type   text NULL,
  cible_id     text NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           inet NULL,
  agent        text NULL
);
CREATE INDEX journal_horodatage_idx ON {{schema}}.journal (horodatage DESC);

CREATE FUNCTION {{schema}}.refuser_modification_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul : % interdit.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER journal_ajout_seul
  BEFORE UPDATE OR DELETE ON {{schema}}.journal
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.refuser_modification_journal();
CREATE TRIGGER journal_pas_de_vidage
  BEFORE TRUNCATE ON {{schema}}.journal
  FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.refuser_modification_journal();

GRANT SELECT, INSERT ON {{schema}}.journal TO {{role}};
