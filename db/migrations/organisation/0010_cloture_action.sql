-- Jalonia — migration ORGANISATION 0010 : auteur de la clôture d'une action (décision n° 5 du 19/10/2026).
-- Le responsable d'une action la fait avancer (à faire, en cours, réalisée) ; une AUTRE personne ayant le droit
-- actions.gerer la clôt ou l'abandonne. L'auteur de ce passage est rangé avec l'action (en plus du journal).
-- Les actions closes avant cette version n'ont pas d'auteur de clôture (NULL) : il reste lisible dans le journal.
ALTER TABLE {{schema}}.actions
  ADD COLUMN cloture_par     uuid NULL,
  ADD COLUMN cloture_par_nom text NOT NULL DEFAULT '' CHECK (char_length(cloture_par_nom) <= 200),
  -- Seule une action close ou abandonnée a un auteur de clôture.
  ADD CONSTRAINT actions_cloture_par_check CHECK (cloture_par IS NULL OR statut IN ('cloturee', 'abandonnee')),
  -- Défense en profondeur : jamais clôturée ni abandonnée par son propre responsable.
  ADD CONSTRAINT actions_cloture_separee_check CHECK (cloture_par IS NULL OR responsable IS NULL OR cloture_par <> responsable);

GRANT UPDATE (cloture_par, cloture_par_nom) ON {{schema}}.actions TO {{role}};
