-- État de maintenance plateforme (une ligne) et textes publics bilingues.
CREATE TABLE platform.maintenance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  actif boolean NOT NULL DEFAULT false,
  message_fr text NOT NULL DEFAULT 'Jalonia est temporairement en maintenance. Merci de réessayer plus tard.' CHECK (char_length(message_fr) BETWEEN 1 AND 1000),
  message_en text NOT NULL DEFAULT 'Jalonia is temporarily under maintenance. Please try again later.' CHECK (char_length(message_en) BETWEEN 1 AND 1000),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid NULL
);
INSERT INTO platform.maintenance (singleton) VALUES (true);
GRANT SELECT ON platform.maintenance TO jalonia_app;
GRANT UPDATE (actif, message_fr, message_en, modifie_le, modifie_par) ON platform.maintenance TO jalonia_app;
