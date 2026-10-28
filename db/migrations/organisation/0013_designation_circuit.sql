-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0013 : DÉSIGNATION NOMINATIVE dans le circuit de validation (28/10/2026).
--
-- À la soumission, la personne qui soumet désigne le vérificateur et l'approbateur : eux seuls décident, eux seuls
-- sont prévenus (avant : tous les membres ayant le rôle). Les noms sont gardés pour l'affichage (« en vérification
-- chez … »). Les désignations s'effacent quand le document revient au brouillon (refus, révision). Un document déjà
-- en circuit avant cette migration n'a pas de désignation : tout membre ayant le rôle peut décider, comme avant.
-- Relance : un document qui attend la même personne depuis 5 jours ouvrés lui est rappelé (notification
-- « validation_relance », tâches quotidiennes).
-- =====================================================================================================

ALTER TABLE {{schema}}.documents
  ADD COLUMN verificateur_designe uuid,
  ADD COLUMN verificateur_designe_nom text NOT NULL DEFAULT '' CHECK (char_length(verificateur_designe_nom) <= 200),
  ADD COLUMN approbateur_designe uuid,
  ADD COLUMN approbateur_designe_nom text NOT NULL DEFAULT '' CHECK (char_length(approbateur_designe_nom) <= 200);

GRANT UPDATE (verificateur_designe, verificateur_designe_nom, approbateur_designe, approbateur_designe_nom) ON {{schema}}.documents TO {{role}};

ALTER TABLE {{schema}}.notifications DROP CONSTRAINT notifications_nature_check;
ALTER TABLE {{schema}}.notifications ADD CONSTRAINT notifications_nature_check CHECK (nature IN (
  'a_verifier', 'a_approuver', 'refuse', 'publie',
  'revue_proche', 'revue_retard', 'revue_escalade',
  'action_confiee', 'action_proche', 'action_retard', 'action_escalade',
  'acces_urgence',
  'absence_titulaire',
  'validation_relance'));
