-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0008 : accès de l'exploitant (décision n° 1 du 19/10/2026, audit S9).
--
-- 1. Un compte superadmin n'est JAMAIS membre d'une organisation : ni invitation, ni rôles qu'il se donnerait.
--    La base le refuse elle-même (déclencheur), en plus des contrôles de l'application.
-- 2. Pour intervenir dans une organisation, le superadmin ouvre un ACCÈS D'URGENCE : un motif, un rôle
--    (administrateur, rédacteur ou lecteur), une durée de 1, 4, 8 ou 24 heures. L'accès est notifié aux
--    administrateurs de l'organisation, tracé dans les deux journaux, et ne vaut plus rien à son échéance.
-- 3. La réinitialisation d'un mot de passe par le superadmin crée un LIEN à usage unique, valable 1 heure, envoyé
--    par courriel à la personne : le superadmin ne choisit ni ne connaît plus aucun mot de passe. Seule l'EMPREINTE
--    (SHA-256) du jeton est rangée, comme pour les invitations.
-- =====================================================================================================

-- Aucune adhésion de superadmin ne doit exister avant d'appliquer la règle (aucune n'est créée par l'application
-- depuis cette version ; une installation qui en aurait doit les retirer à la main, en le traçant).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id WHERE u.est_superadmin) THEN
    RAISE EXCEPTION 'Migration 0008 : un compte superadmin est membre d''une organisation. Retirer ces adhésions avant de migrer.';
  END IF;
END $$;

CREATE FUNCTION platform.refuser_adhesion_superadmin() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, platform AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.utilisateurs WHERE id = NEW.utilisateur_id AND est_superadmin) THEN
    RAISE EXCEPTION 'un compte superadmin ne peut pas être membre d''une organisation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION platform.refuser_adhesion_superadmin() FROM PUBLIC;
CREATE TRIGGER adhesions_sans_superadmin BEFORE INSERT OR UPDATE ON platform.adhesions
  FOR EACH ROW EXECUTE FUNCTION platform.refuser_adhesion_superadmin();

-- ---------- Accès d'urgence ----------
CREATE TABLE platform.acces_urgence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES platform.organisations (id) ON DELETE CASCADE,
  superadmin_id   uuid NOT NULL REFERENCES platform.utilisateurs (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('ADMIN_ORGANISATION', 'REDACTEUR', 'LECTEUR')),
  motif           text NOT NULL CHECK (char_length(motif) BETWEEN 10 AND 2000),
  duree_heures    integer NOT NULL CHECK (duree_heures IN (1, 4, 8, 24)),
  ouvert_le       timestamptz NOT NULL DEFAULT now(),
  expire_le       timestamptz NOT NULL,
  ferme_le        timestamptz NULL,
  ferme_par       uuid NULL REFERENCES platform.utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT acces_urgence_duree CHECK (expire_le > ouvert_le AND expire_le <= ouvert_le + interval '24 hours'),
  CONSTRAINT acces_urgence_fermeture CHECK (ferme_par IS NULL OR ferme_le IS NOT NULL)
);
-- Un seul accès non fermé par superadmin et par organisation (un accès échu est fermé avant d'en ouvrir un autre).
CREATE UNIQUE INDEX acces_urgence_ouvert_idx ON platform.acces_urgence (superadmin_id, organisation_id) WHERE ferme_le IS NULL;
CREATE INDEX acces_urgence_organisation_idx ON platform.acces_urgence (organisation_id, ouvert_le DESC);

CREATE FUNCTION platform.verifier_acces_urgence() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, platform AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.utilisateurs WHERE id = NEW.superadmin_id AND est_superadmin) THEN
    RAISE EXCEPTION 'seul un superadmin ouvre un accès d''urgence' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION platform.verifier_acces_urgence() FROM PUBLIC;
CREATE TRIGGER acces_urgence_superadmin BEFORE INSERT ON platform.acces_urgence
  FOR EACH ROW EXECUTE FUNCTION platform.verifier_acces_urgence();

REVOKE ALL ON platform.acces_urgence FROM PUBLIC;
GRANT SELECT ON platform.acces_urgence TO jalonia_app;
GRANT INSERT (organisation_id, superadmin_id, role, motif, duree_heures, expire_le) ON platform.acces_urgence TO jalonia_app;
GRANT UPDATE (ferme_le, ferme_par) ON platform.acces_urgence TO jalonia_app;

-- ---------- Liens de réinitialisation du mot de passe ----------
CREATE TABLE platform.reinitialisations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id  uuid NOT NULL REFERENCES platform.utilisateurs (id) ON DELETE CASCADE,
  jeton_empreinte text NOT NULL UNIQUE CHECK (jeton_empreinte ~ '^[0-9a-f]{64}$'),
  cree_par        uuid NULL REFERENCES platform.utilisateurs (id) ON DELETE SET NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  expire_le       timestamptz NOT NULL,
  utilisee_le     timestamptz NULL,
  annulee_le      timestamptz NULL,
  CONSTRAINT reinitialisations_duree CHECK (expire_le > cree_le AND expire_le <= cree_le + interval '1 hour'),
  CONSTRAINT reinitialisations_un_seul_denouement CHECK (utilisee_le IS NULL OR annulee_le IS NULL)
);
-- Un seul lien en attente par compte : un nouveau lien annule le précédent.
CREATE UNIQUE INDEX reinitialisations_en_attente_idx ON platform.reinitialisations (utilisateur_id)
  WHERE utilisee_le IS NULL AND annulee_le IS NULL;

REVOKE ALL ON platform.reinitialisations FROM PUBLIC;
GRANT SELECT ON platform.reinitialisations TO jalonia_app;
GRANT INSERT (utilisateur_id, jeton_empreinte, cree_par, expire_le) ON platform.reinitialisations TO jalonia_app;
GRANT UPDATE (utilisee_le, annulee_le) ON platform.reinitialisations TO jalonia_app;
