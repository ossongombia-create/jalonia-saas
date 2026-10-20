-- Jalonia — migration ORGANISATION 0011 : notification « titulaire absent depuis 60 jours » (chantier 2 du 20/10/2026).
-- Adressée au titulaire absent et au suppléant actif ; le superadmin la voit dans ses « Alertes » (et par courriel).
ALTER TABLE {{schema}}.notifications DROP CONSTRAINT notifications_nature_check;
ALTER TABLE {{schema}}.notifications ADD CONSTRAINT notifications_nature_check CHECK (nature IN (
  'a_verifier', 'a_approuver', 'refuse', 'publie',
  'revue_proche', 'revue_retard', 'revue_escalade',
  'action_confiee', 'action_proche', 'action_retard', 'action_escalade',
  'acces_urgence',
  'absence_titulaire'));
