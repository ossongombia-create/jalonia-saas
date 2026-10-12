-- =====================================================================================================
-- Jalonia — migration PLATEFORME 0003 : créer une organisation SANS donner le rôle propriétaire à l'application.
--
-- Avant : l'application en service détenait le mot de passe de jalonia_owner pour créer le schéma et le rôle
-- PostgreSQL d'une organisation (audit S1). Une faille d'exécution de code dans l'application donnait donc
-- tous les droits sur la base.
--
-- Maintenant : une seule fonction, platform.provisionner_organisation(), appartenant au propriétaire et
-- exécutée avec ses droits (SECURITY DEFINER), fait ce travail-là et RIEN d'autre :
--   1. la ligne platform.organisations ;
--   2. le rôle PostgreSQL de l'organisation (sans connexion) ;
--   3. son schéma et ses tables, en appliquant les gabarits rangés dans platform.gabarits_organisation ;
--   4. l'adhésion de jalonia_app à ce rôle, SANS héritage (droits obtenus seulement par SET ROLE).
-- L'application ne reçoit que le droit d'EXÉCUTER cette fonction. Les gabarits sont écrits par le lanceur de
-- migrations (rôle propriétaire) ; l'application ne peut ni les lire ni les modifier.
--
-- Règles de sûreté d'une fonction SECURITY DEFINER : chemin de recherche figé, nom de schéma vérifié par
-- expression régulière AVANT tout SQL dynamique, identifiants cités par format('%I') / quote_ident, nom et
-- identifiant court passés comme valeurs (jamais dans du SQL dynamique), droit d'exécution retiré à PUBLIC.
-- =====================================================================================================

CREATE TABLE platform.gabarits_organisation (
  nom       text PRIMARY KEY CHECK (nom ~ '^[0-9]{4}_[a-z0-9_]+\.sql$'),
  sql       text NOT NULL,
  empreinte text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  range_le  timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform.gabarits_organisation FROM PUBLIC;

CREATE FUNCTION platform.provisionner_organisation(p_nom text, p_slug text, p_schema text, p_cree_par uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fonction$
DECLARE
  v_role text;
  v_id uuid;
  v_gabarits integer := 0;
  g record;
BEGIN
  IF p_schema IS NULL OR p_schema !~ '^org_[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Nom de schéma d''organisation invalide.' USING ERRCODE = '22023';
  END IF;
  v_role := p_schema || '_rw';

  -- Nom et identifiant court : contrôlés par les contraintes de la table (longueur, format, unicité).
  INSERT INTO platform.organisations (nom, slug, schema_name, role_name, cree_par)
  VALUES (p_nom, p_slug, p_schema, v_role, p_cree_par)
  RETURNING id INTO v_id;

  EXECUTE format('CREATE ROLE %I NOLOGIN', v_role);
  EXECUTE format('CREATE SCHEMA %I', p_schema);

  FOR g IN SELECT nom, sql FROM platform.gabarits_organisation ORDER BY nom LOOP
    EXECUTE replace(replace(g.sql, '{{schema}}', quote_ident(p_schema)), '{{role}}', quote_ident(v_role));
    INSERT INTO platform.migrations_organisation (schema_name, nom) VALUES (p_schema, g.nom);
    v_gabarits := v_gabarits + 1;
  END LOOP;
  IF v_gabarits = 0 THEN
    RAISE EXCEPTION 'Aucun gabarit d''organisation : lancer les migrations (scripts/migrer.ts).' USING ERRCODE = '55000';
  END IF;

  EXECUTE format('GRANT %I TO jalonia_app WITH INHERIT FALSE, SET TRUE', v_role);
  RETURN v_id;
END
$fonction$;

REVOKE ALL ON FUNCTION platform.provisionner_organisation(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.provisionner_organisation(text, text, text, uuid) TO jalonia_app;
