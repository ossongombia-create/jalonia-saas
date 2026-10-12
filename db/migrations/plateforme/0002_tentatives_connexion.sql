-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0002 : tentatives de connexion (limitation par adresse IP).
--
-- Une ligne par tentative VÉRIFIÉE (mot de passe réellement contrôlé), réussie ou non. Elle sert à refuser,
-- AVANT tout calcul coûteux :
--   - une adresse qui a échoué trop souvent récemment (tous comptes confondus) ;
--   - un couple (compte, adresse) qui a échoué trop souvent depuis sa dernière réussite ;
-- et à verrouiller un compte attaqué depuis de nombreuses adresses. Voir src/server/auth/connexion.ts.
-- Table d'exploitation (pas un journal d'audit) : les lignes de plus d'un jour sont supprimées.
-- =====================================================================================================

CREATE TABLE platform.tentatives_connexion (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  horodatage  timestamptz NOT NULL DEFAULT now(),
  ip          inet NULL,
  email       text NOT NULL CHECK (char_length(email) <= 254),
  reussie     boolean NOT NULL
);
CREATE INDEX tentatives_ip_idx ON platform.tentatives_connexion (ip, horodatage DESC);
CREATE INDEX tentatives_email_idx ON platform.tentatives_connexion (email, horodatage DESC);
CREATE INDEX tentatives_horodatage_idx ON platform.tentatives_connexion (horodatage);

GRANT SELECT, DELETE ON platform.tentatives_connexion TO jalonia_app;
GRANT INSERT (ip, email, reussie) ON platform.tentatives_connexion TO jalonia_app;
