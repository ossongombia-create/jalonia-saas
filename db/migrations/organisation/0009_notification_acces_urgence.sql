-- Jalonia — migration ORGANISATION 0009 : notification « accès d'urgence » (décision n° 1 du 19/10/2026).
-- À l'ouverture d'un accès d'urgence par l'exploitant, chaque administrateur de l'organisation est notifié
-- (dans l'application, puis par courriel quand le SMTP est configuré).
ALTER TABLE {{schema}}.notifications DROP CONSTRAINT notifications_nature_check;
ALTER TABLE {{schema}}.notifications ADD CONSTRAINT notifications_nature_check CHECK (nature IN (
  'a_verifier', 'a_approuver', 'refuse', 'publie',
  'revue_proche', 'revue_retard', 'revue_escalade',
  'action_confiee', 'action_proche', 'action_retard', 'action_escalade',
  'acces_urgence'));
