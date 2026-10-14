-- Envoi différé des notifications par les tâches quotidiennes. Les notifications in-app restent la source de vérité.
ALTER TABLE {{schema}}.notifications
  ADD COLUMN email_envoyee_le timestamptz NULL,
  ADD COLUMN email_tentatives integer NOT NULL DEFAULT 0 CHECK (email_tentatives >= 0);

CREATE INDEX notifications_email_attente_idx
  ON {{schema}}.notifications (creee_le, id)
  WHERE email_envoyee_le IS NULL AND email_tentatives < 5;

GRANT UPDATE (email_envoyee_le, email_tentatives) ON {{schema}}.notifications TO {{role}};
