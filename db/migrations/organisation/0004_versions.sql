-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0004 : historique des versions et corbeille des documents (audit S5, D1).
--
-- versions_document : copies des contenus, en AJOUT SEUL pour le rôle de l'organisation (ni modification, ni
--   suppression). Une copie est prise à la création, à la validation de la synthèse, avant et après un
--   remplacement (conflit tranché, restauration), quand une autre personne reprend le document (l'état laissé par
--   la précédente est gardé), à la mise en corbeille, et au plus une fois par période pendant l'enregistrement
--   automatique (src/server/documents/versions.ts). Le document lui-même porte toujours la dernière version.
-- Corbeille : un document supprimé n'est plus effacé ; il est marqué (supprime_le) et peut être rétabli. Le rôle de
--   l'organisation perd le droit d'effacer des documents : seul le propriétaire de la base le pourrait.
-- =====================================================================================================

ALTER TABLE {{schema}}.documents
  ADD COLUMN supprime_le timestamptz NULL,
  ADD COLUMN supprime_par uuid NULL,
  ADD COLUMN supprime_par_nom text NOT NULL DEFAULT '';
CREATE INDEX documents_corbeille_idx ON {{schema}}.documents (supprime_le DESC) WHERE supprime_le IS NOT NULL;

CREATE TABLE {{schema}}.versions_document (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id     uuid NOT NULL REFERENCES {{schema}}.documents (id),
  version         integer NOT NULL CHECK (version >= 1),
  type            text NOT NULL DEFAULT '' CHECK (type IN ('', 'procedure', 'instruction')),
  titre           text NOT NULL DEFAULT '' CHECK (char_length(titre) <= 500),
  reference       text NOT NULL DEFAULT '' CHECK (char_length(reference) <= 500),
  contenu         jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object'),
  -- Auteur et date de CETTE version (celle du document au moment où elle a été enregistrée).
  auteur          uuid NULL,
  auteur_nom      text NOT NULL DEFAULT '',
  enregistre_le   timestamptz NOT NULL,
  -- Pourquoi la copie a été prise, et quand.
  motif           text NOT NULL CHECK (motif IN ('creation', 'enregistrement', 'validation', 'avant_remplacement', 'remplacement', 'restauration', 'suppression', 'reprise')),
  copie_le        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

-- Documents déjà présents : leur état actuel devient la première version connue.
INSERT INTO {{schema}}.versions_document (document_id, version, type, titre, reference, contenu, auteur, auteur_nom, enregistre_le, motif)
SELECT id, version, type, titre, reference, contenu, modifie_par, modifie_par_nom, modifie_le, 'reprise' FROM {{schema}}.documents;

REVOKE DELETE ON {{schema}}.documents FROM {{role}};
GRANT UPDATE (supprime_le, supprime_par, supprime_par_nom) ON {{schema}}.documents TO {{role}};
GRANT SELECT, INSERT ON {{schema}}.versions_document TO {{role}};
