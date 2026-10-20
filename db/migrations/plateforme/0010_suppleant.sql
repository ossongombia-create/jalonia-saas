-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0010 : binôme d'administration titulaire / suppléant (chantier 2 du 20/10/2026).
--
-- Chaque organisation a un administrateur TITULAIRE et un SUPPLÉANT, désignés par le superadmin.
--   - Le suppléant INACTIF n'a PAS le rôle Administrateur (rôle Lecteur par défaut) : il ne compte donc nulle part
--     comme administrateur. Le superadmin l'ACTIVE (rôle Administrateur ajouté) ou il redevient inactif (rôle retiré)
--     au retour du titulaire. Le rôle porte l'état : la contrainte ci-dessous l'impose.
--   - Le titulaire a toujours le rôle Administrateur. Il peut être marqué ABSENT (date de début, motif facultatif
--     visible du superadmin seulement) : seul le compte des 60 jours en dépend, aucun droit ne change.
--   - Les co-administrateurs (sans fonction) restent permis.
-- Les invitations portent la fonction (titulaire : rôle Administrateur ; suppléant : rôle Lecteur).
-- Aucun remplissage : les organisations existantes reçoivent un titulaire quand le superadmin leur ajoute un suppléant.
-- =====================================================================================================
ALTER TABLE platform.adhesions
  ADD COLUMN fonction_org        text NULL CHECK (fonction_org IN ('titulaire', 'suppleant')),
  ADD COLUMN statut_suppleant    text NULL CHECK (statut_suppleant IN ('inactif', 'actif')),
  ADD COLUMN date_absence_debut  timestamptz NULL,
  ADD COLUMN motif_absence       text NULL CHECK (char_length(motif_absence) <= 2000),
  -- Un état de suppléant pour le suppléant, et pour lui seul.
  ADD CONSTRAINT adhesions_etat_suppleant_check CHECK ((statut_suppleant IS NOT NULL) = (fonction_org IS NOT DISTINCT FROM 'suppleant')),
  -- Le rôle porte l'état : suppléant actif ⇔ rôle Administrateur.
  ADD CONSTRAINT adhesions_suppleant_role_check CHECK (fonction_org IS DISTINCT FROM 'suppleant' OR ((statut_suppleant = 'actif') = ('ADMIN_ORGANISATION' = ANY (roles)))),
  -- Le titulaire est toujours administrateur.
  ADD CONSTRAINT adhesions_titulaire_role_check CHECK (fonction_org IS DISTINCT FROM 'titulaire' OR 'ADMIN_ORGANISATION' = ANY (roles)),
  -- L'absence (et son motif) ne concerne que le titulaire ; pas de motif sans absence.
  ADD CONSTRAINT adhesions_absence_check CHECK (date_absence_debut IS NULL OR fonction_org IS NOT DISTINCT FROM 'titulaire'),
  ADD CONSTRAINT adhesions_motif_sans_absence_check CHECK (motif_absence IS NULL OR date_absence_debut IS NOT NULL);

-- Un seul titulaire et un seul suppléant par organisation.
CREATE UNIQUE INDEX adhesions_un_titulaire_idx ON platform.adhesions (organisation_id) WHERE fonction_org = 'titulaire';
CREATE UNIQUE INDEX adhesions_un_suppleant_idx ON platform.adhesions (organisation_id) WHERE fonction_org = 'suppleant';

ALTER TABLE platform.invitations
  ADD COLUMN fonction_org text NULL CHECK (fonction_org IN ('titulaire', 'suppleant')),
  ADD CONSTRAINT invitations_fonction_roles_check CHECK (
    fonction_org IS NULL
    OR (fonction_org = 'titulaire' AND roles = '{ADMIN_ORGANISATION}')
    OR (fonction_org = 'suppleant' AND roles = '{LECTEUR}')
  );

GRANT INSERT (fonction_org, statut_suppleant) ON platform.adhesions TO jalonia_app;
GRANT UPDATE (fonction_org, statut_suppleant, date_absence_debut, motif_absence) ON platform.adhesions TO jalonia_app;
GRANT INSERT (fonction_org) ON platform.invitations TO jalonia_app;
