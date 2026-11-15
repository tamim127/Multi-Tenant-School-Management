-- Local/CI bootstrap only. Production roles and secrets are managed out of band.
CREATE ROLE edu_runtime LOGIN PASSWORD 'runtime_local_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
