-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0007 : actions, objectifs et mesures des indicateurs (audit Q1).
--
-- Les risques, les opportunités et les indicateurs restent décrits DANS les documents (instructions des procédures) :
-- les registres les lisent (version publiée). Cette migration ajoute ce qui n'est pas dans les documents :
-- actions : plan d'actions de l'organisation (origine : risque, opportunité, indicateur, revue, audit, non-conformité,
--   réclamation, autre), avec responsable, échéance, avancement et vérification de l'efficacité (ISO 9001 § 10.2).
--   Une action peut viser un élément d'un document (document_id + element_id : identifiant du risque, de l'opportunité
--   ou de l'instruction dans le contenu) ; element_libelle garde le texte de l'élément au moment de la création.
-- objectifs_indicateur : objectif chiffré d'un indicateur (au moins / au plus une valeur), posé par la direction.
-- mesures_indicateur : une valeur par indicateur et par date de mesure.
-- Aucune suppression d'action (une action se clôt ou s'abandonne, avec un motif) ; mesures et objectifs se corrigent,
-- et chaque correction est inscrite au journal de l'organisation.
-- =====================================================================================================

CREATE TABLE {{schema}}.actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  titre            text NOT NULL CHECK (char_length(btrim(titre)) BETWEEN 1 AND 200),
  description      text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  origine          text NOT NULL CHECK (origine IN ('risque', 'opportunite', 'indicateur', 'revue', 'audit', 'non_conformite', 'reclamation', 'autre')),
  document_id      uuid NULL REFERENCES {{schema}}.documents (id),
  element_id       text NULL CHECK (element_id IS NULL OR char_length(element_id) BETWEEN 1 AND 100),
  element_libelle  text NOT NULL DEFAULT '' CHECK (char_length(element_libelle) <= 500),
  responsable      uuid NULL,
  responsable_nom  text NOT NULL DEFAULT '' CHECK (char_length(responsable_nom) <= 200),
  echeance         date NULL,
  statut           text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'en_cours', 'realisee', 'cloturee', 'abandonnee')),
  -- Compte rendu (réalisation, vérification de l'efficacité, motif d'abandon).
  resultat         text NOT NULL DEFAULT '' CHECK (char_length(resultat) <= 4000),
  -- Efficacité vérifiée à la clôture (obligatoire pour une action close, absente sinon).
  efficace         boolean NULL,
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  cree_par         uuid NULL,
  cree_par_nom     text NOT NULL DEFAULT '',
  cree_le          timestamptz NOT NULL DEFAULT now(),
  modifie_par      uuid NULL,
  modifie_par_nom  text NOT NULL DEFAULT '',
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  cloture_le       timestamptz NULL,
  CHECK ((element_id IS NULL) OR (document_id IS NOT NULL)),
  CHECK ((statut = 'cloturee') = (efficace IS NOT NULL)),
  CHECK ((statut IN ('cloturee', 'abandonnee')) = (cloture_le IS NOT NULL))
);
CREATE INDEX actions_document_idx ON {{schema}}.actions (document_id, element_id) WHERE document_id IS NOT NULL;
CREATE INDEX actions_ouvertes_idx ON {{schema}}.actions (echeance) WHERE statut IN ('a_faire', 'en_cours');

CREATE TABLE {{schema}}.objectifs_indicateur (
  document_id      uuid NOT NULL REFERENCES {{schema}}.documents (id),
  element_id       text NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 100),
  -- « min » : l'objectif est atteint si la mesure est AU MOINS le seuil ; « max » : AU PLUS le seuil.
  sens             text NOT NULL CHECK (sens IN ('min', 'max')),
  seuil            numeric(18, 4) NOT NULL,
  unite            text NOT NULL DEFAULT '' CHECK (char_length(unite) <= 30),
  modifie_par      uuid NULL,
  modifie_par_nom  text NOT NULL DEFAULT '',
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, element_id)
);

CREATE TABLE {{schema}}.mesures_indicateur (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id      uuid NOT NULL REFERENCES {{schema}}.documents (id),
  element_id       text NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 100),
  -- Nom de l'indicateur au moment de la mesure (il peut changer dans une révision du document).
  nom              text NOT NULL DEFAULT '' CHECK (char_length(nom) <= 500),
  date_mesure      date NOT NULL,
  valeur           numeric(18, 4) NOT NULL,
  commentaire      text NOT NULL DEFAULT '' CHECK (char_length(commentaire) <= 1000),
  saisi_par        uuid NULL,
  saisi_par_nom    text NOT NULL DEFAULT '',
  saisi_le         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, element_id, date_mesure)
);
CREATE INDEX mesures_indicateur_idx ON {{schema}}.mesures_indicateur (document_id, element_id, date_mesure DESC);

GRANT SELECT, INSERT ON {{schema}}.actions TO {{role}};
GRANT UPDATE (titre, description, origine, responsable, responsable_nom, echeance, statut, resultat, efficace, version,
              modifie_par, modifie_par_nom, modifie_le, cloture_le) ON {{schema}}.actions TO {{role}};
GRANT SELECT, INSERT, DELETE ON {{schema}}.objectifs_indicateur TO {{role}};
GRANT UPDATE (sens, seuil, unite, modifie_par, modifie_par_nom, modifie_le) ON {{schema}}.objectifs_indicateur TO {{role}};
GRANT SELECT, INSERT, DELETE ON {{schema}}.mesures_indicateur TO {{role}};
GRANT UPDATE (nom, valeur, commentaire, saisi_par, saisi_par_nom, saisi_le) ON {{schema}}.mesures_indicateur TO {{role}};
