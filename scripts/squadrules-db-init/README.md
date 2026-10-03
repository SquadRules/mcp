# Postgres init (deprecated)

Postgres now uses the default Docker workflow: only the Keycloak DB is created, via env vars
`POSTGRES_USER=keycloak`, `POSTGRES_DB=keycloak`, `POSTGRES_PASSWORD=KEYCLOAK_DB_PASSWORD`
(see `compose.yaml`). No init scripts are mounted; this directory is kept for reference.
