-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0012 : FONCTION de la personne à chaque étape du circuit (TC-03).
--
-- Valider une étape (soumettre, vérifier, approuver) demande le NOM et la FONCTION de la personne, sans signature :
-- le nom est celui de son compte (acteur_nom, déjà rangé) ; la fonction est saisie à chaque décision et rangée ici.
-- Ils alimentent le tableau « Rédigé / Vérifié / Approuvé » du document imprimé (la case « Visa » reste vide, pour
-- la signature sur papier). Les décisions déjà rangées gardent une fonction vide.
-- Droits : le rôle de l'organisation a déjà SELECT et INSERT sur toute la table (migration 0005).
-- =====================================================================================================

ALTER TABLE {{schema}}.decisions_document
  ADD COLUMN acteur_fonction text NOT NULL DEFAULT '' CHECK (char_length(acteur_fonction) <= 200);
