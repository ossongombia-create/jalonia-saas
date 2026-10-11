-- =====================================================================================================
-- Jalonia — préparation de PostgreSQL (une seule fois, par un superutilisateur PostgreSQL).
--
-- Usage (sur le serveur) :
--   sudo -u postgres psql -v ON_ERROR_STOP=1 \
--        -v nom_base=jalonia -v mdp_proprietaire='…' -v mdp_app='…' \
--        -f deploy/preparer-base.sql
--
-- Crée (ou remet en conformité, sans rien effacer) :
--   jalonia_owner : propriétaire de la base ; migrations et création d'organisations UNIQUEMENT.
--                   CREATEROLE : il crée le rôle PostgreSQL de chaque organisation.
--   jalonia_app   : rôle utilisé par l'application web ; aucun droit par défaut, il ne reçoit que ceux
--                   accordés par les migrations (table par table, colonne par colonne).
--   la base :nom_base, propriété de jalonia_owner, fermée à tous les autres rôles.
-- Rejouable sans risque : il met à jour les mots de passe et les attributs, ne supprime rien.
-- =====================================================================================================
\set ON_ERROR_STOP on

-- ----- Rôles -----
SELECT 'CREATE ROLE jalonia_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jalonia_owner') \gexec
SELECT 'CREATE ROLE jalonia_app' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jalonia_app') \gexec

ALTER ROLE jalonia_owner WITH LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'mdp_proprietaire';
ALTER ROLE jalonia_app   WITH LOGIN NOCREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'mdp_app';

-- Garde-fous côté serveur pour le rôle de l'application :
--   chemin de recherche vide (un nom de table non qualifié ne correspond à rien), requêtes limitées
--   à 30 s, transaction abandonnée au-delà de 60 s d'inactivité.
ALTER ROLE jalonia_app SET search_path = '';
ALTER ROLE jalonia_app SET statement_timeout = '30s';
ALTER ROLE jalonia_app SET idle_in_transaction_session_timeout = '60s';

-- ----- Base -----
SELECT format('CREATE DATABASE %I OWNER jalonia_owner ENCODING %L TEMPLATE template0', :'nom_base', 'UTF8')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'nom_base') \gexec

REVOKE ALL ON DATABASE :"nom_base" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"nom_base" TO jalonia_app;

-- Dans la base : personne ne crée d'objets dans « public ».
\connect :"nom_base"
REVOKE ALL ON SCHEMA public FROM PUBLIC;

\echo 'Base prête.'
