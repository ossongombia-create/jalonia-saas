-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0005 : circuit de validation des documents (audit W1, W3).
--
-- États : brouillon → en_verification → en_approbation → publie → archive (refus : retour au brouillon, motif
-- obligatoire ; révision d'un document publié : retour au brouillon). Seul un brouillon se modifie.
-- decisions_document : chaque décision du circuit, en AJOUT SEUL pour le rôle de l'organisation, avec la version
--   concernée, le motif et l'empreinte SHA-256 du contenu au moment de la décision. C'est une TRACE d'approbation :
--   ce n'est pas une signature électronique, et aucune valeur légale n'est revendiquée.
-- Les documents existants commencent à l'état « brouillon ».
-- =====================================================================================================

ALTER TABLE {{schema}}.documents
  ADD COLUMN etat text NOT NULL DEFAULT 'brouillon' CHECK (etat IN ('brouillon', 'en_verification', 'en_approbation', 'publie', 'archive')),
  ADD COLUMN version_publiee integer NULL,
  ADD COLUMN publie_le timestamptz NULL;

CREATE TABLE {{schema}}.decisions_document (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id     uuid NOT NULL REFERENCES {{schema}}.documents (id),
  version         integer NOT NULL CHECK (version >= 1),
  transition      text NOT NULL CHECK (transition IN ('soumettre', 'verifier', 'refuser_verification', 'approuver', 'refuser_approbation', 'archiver', 'reviser')),
  etat_avant      text NOT NULL,
  etat_apres      text NOT NULL,
  motif           text NOT NULL DEFAULT '' CHECK (char_length(motif) <= 2000),
  -- SHA-256 du contenu (forme canonique jsonb) au moment de la décision : la version décidée est identifiable.
  empreinte       text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  acteur          uuid NULL,
  acteur_nom      text NOT NULL DEFAULT '',
  decide_le       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_document_idx ON {{schema}}.decisions_document (document_id, id DESC);

-- Copie de l'historique prise à la soumission (la version soumise est celle qui sera vérifiée, approuvée et publiée :
-- elle ne se modifie plus, elle est donc conservée telle quelle).
ALTER TABLE {{schema}}.versions_document DROP CONSTRAINT versions_document_motif_check;
ALTER TABLE {{schema}}.versions_document ADD CONSTRAINT versions_document_motif_check
  CHECK (motif IN ('creation', 'enregistrement', 'validation', 'avant_remplacement', 'remplacement', 'restauration', 'suppression', 'reprise', 'soumission'));

GRANT UPDATE (etat, version_publiee, publie_le) ON {{schema}}.documents TO {{role}};
GRANT SELECT, INSERT ON {{schema}}.decisions_document TO {{role}};
