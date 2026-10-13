-- Run as the migration/database owner after creating the rq_runtime role with
-- a password supplied outside this file. Use its URL for application services.
GRANT CONNECT ON DATABASE reliable_queue TO rq_runtime;
GRANT USAGE ON SCHEMA public TO rq_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rq_runtime;
REVOKE ALL ON schema_migrations FROM rq_runtime;
GRANT SELECT ON schema_migrations TO rq_runtime;
-- UUID identifiers need no sequence grants. The runtime role receives no DDL
-- or ownership privileges. Reapply grants after future owner-run migrations.
