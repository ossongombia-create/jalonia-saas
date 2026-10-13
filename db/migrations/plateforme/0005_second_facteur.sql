-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0005 : second facteur d'authentification (audit S3).
--
-- Codes à usage unique de 6 chiffres (TOTP, RFC 6238 : application d'authentification sur téléphone) et codes
-- de secours. OBLIGATOIRE pour les superadministrateurs, facultatif pour les autres comptes.
--   - utilisateurs.mfa_secret_chiffre : secret TOTP CHIFFRÉ (AES-256-GCM, clé CLE_SECOND_FACTEUR du fichier
--     d'environnement du service, lié à l'identifiant du compte) ; présent mais non activé pendant l'enrôlement ;
--   - utilisateurs.mfa_dernier_pas : dernier pas de 30 s accepté (un code ne sert qu'une fois) ;
--   - utilisateurs.echecs_mfa : échecs consécutifs (verrouillage du compte au-delà d'un seuil) ;
--   - sessions.en_attente_mfa : session ouverte par le mot de passe, inutilisable tant que le code n'est pas donné ;
--   - codes_secours : empreintes HMAC-SHA-256 (même clé) de 10 codes à usage unique.
-- =====================================================================================================

ALTER TABLE platform.utilisateurs
  ADD COLUMN mfa_secret_chiffre text NULL CHECK (mfa_secret_chiffre ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  ADD COLUMN mfa_active_le timestamptz NULL,
  ADD COLUMN mfa_dernier_pas bigint NULL CHECK (mfa_dernier_pas >= 0),
  ADD COLUMN echecs_mfa integer NOT NULL DEFAULT 0 CHECK (echecs_mfa >= 0),
  ADD CONSTRAINT utilisateurs_mfa_active_avec_secret CHECK (mfa_active_le IS NULL OR mfa_secret_chiffre IS NOT NULL);

GRANT UPDATE (mfa_secret_chiffre, mfa_active_le, mfa_dernier_pas, echecs_mfa) ON platform.utilisateurs TO jalonia_app;

ALTER TABLE platform.sessions
  ADD COLUMN en_attente_mfa boolean NOT NULL DEFAULT false,
  ADD COLUMN echecs_mfa integer NOT NULL DEFAULT 0 CHECK (echecs_mfa >= 0);

GRANT INSERT (en_attente_mfa) ON platform.sessions TO jalonia_app;
GRANT UPDATE (en_attente_mfa, echecs_mfa) ON platform.sessions TO jalonia_app;

CREATE TABLE platform.codes_secours (
  utilisateur_id uuid NOT NULL REFERENCES platform.utilisateurs (id) ON DELETE CASCADE,
  empreinte      text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  cree_le        timestamptz NOT NULL DEFAULT now(),
  utilise_le     timestamptz NULL,
  PRIMARY KEY (utilisateur_id, empreinte)
);

REVOKE ALL ON platform.codes_secours FROM PUBLIC;
GRANT SELECT, DELETE ON platform.codes_secours TO jalonia_app;
GRANT INSERT (utilisateur_id, empreinte) ON platform.codes_secours TO jalonia_app;
GRANT UPDATE (utilise_le) ON platform.codes_secours TO jalonia_app;
