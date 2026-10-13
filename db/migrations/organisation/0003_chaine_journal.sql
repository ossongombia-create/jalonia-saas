-- =====================================================================================================
-- Jalonia — migration ORGANISATION 0003 : journal de l'organisation chaîné par empreintes (audit S6).
-- Mêmes règles que le journal de la plateforme (migration plateforme 0006), même verrou consultatif.
-- =====================================================================================================

-- Chaque ligne porte :
--   - chaine_rang : sa place dans la chaîne (1, 2, 3… sans trou) ;
--   - chaine_empreinte : SHA-256( empreinte de la ligne précédente | représentation canonique de la ligne ).
-- Modifier, supprimer ou insérer une ligne après coup (même en désactivant les déclencheurs, ce que seul le rôle
-- propriétaire peut faire) casse la chaîne à cet endroit : scripts/verifier-journal.ts la recalcule depuis le
-- début avec les seules fonctions intégrées de PostgreSQL et la compare aux « ancres » exportées hors du serveur
-- (deploy/sauvegarde.sh). Un verrou consultatif unique (7255102710), pris jusqu'à la fin de la transaction, ordonne
-- toutes les écritures de journal : la chaîne ne peut pas bifurquer (et le rang est UNIQUE en dernier rempart).

ALTER TABLE {{schema}}.journal ADD COLUMN chaine_rang bigint, ADD COLUMN chaine_empreinte text;

-- Lignes déjà présentes : chaînées dans l'ordre de leur numéro (le temps de cette transaction seulement, le
-- déclencheur « ajout seul » est suspendu ; la table reste verrouillée jusqu'à la validation).
ALTER TABLE {{schema}}.journal DISABLE TRIGGER journal_ajout_seul;
DO $chainage$
DECLARE
  r record;
  v_prec text := repeat('0', 64);
  v_rang bigint := 0;
BEGIN
  FOR r IN SELECT * FROM {{schema}}.journal ORDER BY id LOOP
    v_rang := v_rang + 1;
    v_prec := encode(sha256(convert_to(v_prec || '|' || /*canon*/concat_ws('|', r.id::text, to_char(r.horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), quote_nullable(r.acteur_id::text), quote_nullable(r.acteur_email), quote_nullable(r.action), quote_nullable(r.cible_type), quote_nullable(r.cible_id), quote_nullable(r.details::text), quote_nullable(r.ip::text), quote_nullable(r.agent))/*fin*/, 'UTF8')), 'hex');
    UPDATE {{schema}}.journal SET chaine_rang = v_rang, chaine_empreinte = v_prec WHERE id = r.id;
  END LOOP;
END
$chainage$;
ALTER TABLE {{schema}}.journal ENABLE TRIGGER journal_ajout_seul;

ALTER TABLE {{schema}}.journal
  ALTER COLUMN chaine_rang SET NOT NULL,
  ALTER COLUMN chaine_empreinte SET NOT NULL,
  ADD CONSTRAINT journal_chaine_rang_unique UNIQUE (chaine_rang),
  ADD CONSTRAINT journal_chaine_rang_positif CHECK (chaine_rang >= 1),
  ADD CONSTRAINT journal_chaine_empreinte_format CHECK (chaine_empreinte ~ '^[0-9a-f]{64}$');

CREATE FUNCTION {{schema}}.chainer_journal() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fonction$
DECLARE
  v_rang bigint;
  v_prec text;
BEGIN
  PERFORM pg_advisory_xact_lock(7255102710);
  SELECT chaine_rang, chaine_empreinte INTO v_rang, v_prec FROM {{schema}}.journal ORDER BY chaine_rang DESC LIMIT 1;
  NEW.chaine_rang := coalesce(v_rang, 0) + 1;
  NEW.chaine_empreinte := encode(sha256(convert_to(coalesce(v_prec, repeat('0', 64)) || '|' || /*canon*/concat_ws('|', NEW.id::text, to_char(NEW.horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), quote_nullable(NEW.acteur_id::text), quote_nullable(NEW.acteur_email), quote_nullable(NEW.action), quote_nullable(NEW.cible_type), quote_nullable(NEW.cible_id), quote_nullable(NEW.details::text), quote_nullable(NEW.ip::text), quote_nullable(NEW.agent))/*fin*/, 'UTF8')), 'hex');
  RETURN NEW;
END
$fonction$;

CREATE TRIGGER journal_chainage
  BEFORE INSERT ON {{schema}}.journal
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.chainer_journal();
