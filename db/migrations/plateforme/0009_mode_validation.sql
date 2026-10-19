-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0009 : mode de validation d'une organisation (décision n° 2 du 19/10/2026).
--
-- « standard » (par défaut) : trois personnes distinctes pour publier un document (rédaction ou soumission,
-- vérification, approbation).
-- « petite_organisation » : deux personnes suffisent ; la personne qui a rédigé ou soumis la version ne peut toujours
-- ni la vérifier ni l'approuver, mais la même autre personne peut vérifier puis approuver. Le mode est activé par
-- l'exploitant (superadmin), tracé dans les deux journaux ; le critère (moins de 5 salariés) est fixé au contrat.
-- =====================================================================================================
ALTER TABLE platform.organisations
  ADD COLUMN mode_validation text NOT NULL DEFAULT 'standard' CHECK (mode_validation IN ('standard', 'petite_organisation'));

GRANT UPDATE (mode_validation) ON platform.organisations TO jalonia_app;
