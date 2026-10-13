-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0006 : revues périodiques et notifications (audit W2).
--
-- parametres : réglages de l'organisation (une seule ligne) — période de revue des documents publiés, délai de
--   rappel avant l'échéance, délai d'escalade après l'échéance. Valeurs par défaut à confirmer par Brice.
-- documents.revue_le : instant de la dernière approbation ou de la dernière revue confirmée ; l'échéance de la
--   revue suivante = ce jour (fuseau de la plateforme) + la période (calculée par l'application : un changement de
--   période vaut aussitôt pour tous les documents).
-- decisions_document : nouvelle décision « confirmer_revue » (document publié revu et maintenu tel quel).
-- notifications : messages adressés à une personne de l'organisation (décisions du circuit, rappels de revue,
--   échéances des actions). Une même notification n'est créée qu'une fois (clé unique par destinataire). Ce n'est
--   pas une trace d'audit (le journal l'est) : les notifications lues anciennes peuvent être supprimées.
-- =====================================================================================================

CREATE TABLE {{schema}}.parametres (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  periode_revue_mois  integer NOT NULL DEFAULT 24 CHECK (periode_revue_mois BETWEEN 1 AND 120),
  rappel_jours        integer NOT NULL DEFAULT 30 CHECK (rappel_jours BETWEEN 0 AND 365),
  escalade_jours      integer NOT NULL DEFAULT 30 CHECK (escalade_jours BETWEEN 1 AND 365),
  modifie_par         uuid NULL,
  modifie_par_nom     text NOT NULL DEFAULT '',
  modifie_le          timestamptz NULL
);
INSERT INTO {{schema}}.parametres (id) VALUES (1);

ALTER TABLE {{schema}}.documents ADD COLUMN revue_le timestamptz NULL;
-- Documents déjà publiés : leur publication compte comme dernière revue.
UPDATE {{schema}}.documents SET revue_le = publie_le WHERE etat = 'publie' AND publie_le IS NOT NULL;

ALTER TABLE {{schema}}.decisions_document DROP CONSTRAINT decisions_document_transition_check;
ALTER TABLE {{schema}}.decisions_document ADD CONSTRAINT decisions_document_transition_check
  CHECK (transition IN ('soumettre', 'verifier', 'refuser_verification', 'approuver', 'refuser_approbation', 'archiver', 'reviser', 'confirmer_revue'));

CREATE TABLE {{schema}}.notifications (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  destinataire  uuid NOT NULL,
  nature        text NOT NULL CHECK (nature IN (
                  'a_verifier', 'a_approuver', 'refuse', 'publie',
                  'revue_proche', 'revue_retard', 'revue_escalade',
                  'action_confiee', 'action_proche', 'action_retard', 'action_escalade')),
  -- Clé de dédoublonnage : une même notification n'est jamais créée deux fois pour la même personne.
  cle           text NOT NULL CHECK (char_length(cle) BETWEEN 1 AND 300),
  document_id   uuid NULL,
  action_id     uuid NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 4000),
  creee_le      timestamptz NOT NULL DEFAULT now(),
  lue_le        timestamptz NULL,
  UNIQUE (destinataire, cle)
);
CREATE INDEX notifications_destinataire_idx ON {{schema}}.notifications (destinataire, id DESC);

GRANT SELECT ON {{schema}}.parametres TO {{role}};
GRANT UPDATE (periode_revue_mois, rappel_jours, escalade_jours, modifie_par, modifie_par_nom, modifie_le) ON {{schema}}.parametres TO {{role}};
GRANT UPDATE (revue_le) ON {{schema}}.documents TO {{role}};
GRANT SELECT, INSERT, DELETE ON {{schema}}.notifications TO {{role}};
GRANT UPDATE (lue_le) ON {{schema}}.notifications TO {{role}};
