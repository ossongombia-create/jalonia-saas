-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0004 : invitations à rejoindre une organisation (audit S8, S10).
--
-- Avant : l'administrateur d'une organisation rattachait d'office n'importe quel compte existant (sans son
-- accord) et fixait le mot de passe provisoire des nouveaux comptes.
-- Maintenant : il crée une INVITATION (adresse, nom, rôles). La personne reçoit un lien à usage unique,
-- valable 72 heures :
--   - sans compte Jalonia, elle crée le sien en choisissant SON mot de passe ;
--   - avec un compte, elle se connecte et accepte (ou non).
-- Seule l'EMPREINTE du jeton (SHA-256) est rangée : la base ne permet pas de reconstituer un lien.
-- =====================================================================================================

CREATE TABLE platform.invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES platform.organisations (id) ON DELETE CASCADE,
  email           text NOT NULL
                    CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
  nom             text NOT NULL CHECK (char_length(nom) BETWEEN 1 AND 200),
  roles           text[] NOT NULL CHECK (
                    cardinality(roles) BETWEEN 1 AND 5
                    AND roles <@ ARRAY['ADMIN_ORGANISATION', 'REDACTEUR', 'VERIFICATEUR', 'APPROBATEUR', 'LECTEUR']::text[]
                  ),
  jeton_empreinte text NOT NULL UNIQUE CHECK (jeton_empreinte ~ '^[0-9a-f]{64}$'),
  cree_par        uuid NULL REFERENCES platform.utilisateurs (id) ON DELETE SET NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  expire_le       timestamptz NOT NULL,
  acceptee_le     timestamptz NULL,
  acceptee_par    uuid NULL REFERENCES platform.utilisateurs (id) ON DELETE SET NULL,
  annulee_le      timestamptz NULL,
  CONSTRAINT invitations_expire_apres_creation CHECK (expire_le > cree_le),
  CONSTRAINT invitations_acceptee_par_si_acceptee CHECK (acceptee_par IS NULL OR acceptee_le IS NOT NULL),
  CONSTRAINT invitations_un_seul_denouement CHECK (acceptee_le IS NULL OR annulee_le IS NULL)
);

-- Une seule invitation en attente par organisation et par adresse (une nouvelle invitation annule la précédente).
CREATE UNIQUE INDEX invitations_en_attente_idx ON platform.invitations (organisation_id, email)
  WHERE acceptee_le IS NULL AND annulee_le IS NULL;

REVOKE ALL ON platform.invitations FROM PUBLIC;
GRANT SELECT ON platform.invitations TO jalonia_app;
GRANT INSERT (organisation_id, email, nom, roles, jeton_empreinte, cree_par, expire_le) ON platform.invitations TO jalonia_app;
GRANT UPDATE (acceptee_le, acceptee_par, annulee_le) ON platform.invitations TO jalonia_app;

-- Liste des membres : « dernière action DANS l'organisation » (et non plus la dernière connexion à toute la
-- plateforme, que l'administrateur d'une organisation n'a pas à connaître).
CREATE INDEX journal_organisation_acteur_idx ON platform.journal (organisation_id, acteur_id, horodatage DESC);
