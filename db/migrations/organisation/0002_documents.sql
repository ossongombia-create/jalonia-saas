-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0002 : les documents Qualigramme de l'organisation.
--   documents    : procédures (niveau 2) et instructions de travail (niveau 3), une ligne par document ;
--   cartographie : la cartographie des processus (niveau 1) et ses fiches, UNE seule par organisation.
--
-- Le contenu est celui de l'éditeur (le même objet que les fichiers .json de l'application d'origine),
-- rangé en jsonb. Titre, code et type en sont recopiés à chaque enregistrement pour afficher la liste
-- sans lire les contenus.
--
-- « version » : numéro incrémenté à chaque enregistrement. L'éditeur envoie la version qu'il a ouverte ;
-- si quelqu'un a enregistré entre-temps, le serveur refuse (conflit) au lieu d'écraser son travail.
--
-- Gabarit : {{schema}} et {{role}} sont remplacés par le lanceur (voir 0001_socle.sql).
-- =====================================================================================================

CREATE TABLE {{schema}}.documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL DEFAULT '' CHECK (type IN ('', 'procedure', 'instruction')),
  titre           text NOT NULL DEFAULT '' CHECK (char_length(titre) <= 500),
  reference       text NOT NULL DEFAULT '' CHECK (char_length(reference) <= 500),
  contenu         jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object'),
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  cree_par        uuid NULL,
  cree_par_nom    text NOT NULL DEFAULT '',
  cree_le         timestamptz NOT NULL DEFAULT now(),
  modifie_par     uuid NULL,
  modifie_par_nom text NOT NULL DEFAULT '',
  modifie_le      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_modifie_le_idx ON {{schema}}.documents (modifie_le DESC);

-- Une seule ligne (id = 1), créée ici : version 0 = cartographie jamais enregistrée.
CREATE TABLE {{schema}}.cartographie (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  contenu         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(contenu) = 'object'),
  version         integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  modifie_par     uuid NULL,
  modifie_par_nom text NOT NULL DEFAULT '',
  modifie_le      timestamptz NULL
);
INSERT INTO {{schema}}.cartographie (id) VALUES (1);

-- Regroupement des enregistrements automatiques dans le journal : recherche de la dernière trace
-- d'une même cible (un document) par une même personne.
CREATE INDEX journal_cible_idx ON {{schema}}.journal (cible_id, horodatage DESC);

-- Droits du rôle de l'organisation. Les colonnes de création ne peuvent pas être modifiées après coup.
GRANT SELECT, INSERT, DELETE ON {{schema}}.documents TO {{role}};
GRANT UPDATE (type, titre, reference, contenu, version, modifie_par, modifie_par_nom, modifie_le) ON {{schema}}.documents TO {{role}};
GRANT SELECT ON {{schema}}.cartographie TO {{role}};
GRANT UPDATE (contenu, version, modifie_par, modifie_par_nom, modifie_le) ON {{schema}}.cartographie TO {{role}};
