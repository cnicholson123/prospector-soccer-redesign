-- Phase 6, migration 1. Body preserves the exact Store envelope (including
-- optional fields); generated columns cannot drift from it and support indexes.
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS docs (
 id text PRIMARY KEY, body jsonb NOT NULL CHECK (jsonb_typeof(body)='object' AND body->>'id'=id),
 collection text GENERATED ALWAYS AS (body->>'collection') STORED NOT NULL,
 draft jsonb GENERATED ALWAYS AS (body->'draft') STORED,
 published jsonb GENERATED ALWAYS AS (body->'published') STORED,
 version integer GENERATED ALWAYS AS ((body->>'version')::integer) STORED CHECK (version>0),
 published_version integer GENERATED ALWAYS AS ((body->>'publishedVersion')::integer) STORED,
 "order" integer GENERATED ALWAYS AS ((body->>'order')::integer) STORED,
 published_order integer GENERATED ALWAYS AS ((body->>'publishedOrder')::integer) STORED
);
CREATE INDEX IF NOT EXISTS docs_collection_order ON docs(collection,"order",id);
CREATE TABLE IF NOT EXISTS revisions (
 id text PRIMARY KEY, body jsonb NOT NULL CHECK(body->>'id'=id),
 collection text GENERATED ALWAYS AS (body->>'collection') STORED NOT NULL,
 doc_id text GENERATED ALWAYS AS (body->>'docId') STORED NOT NULL,
 doc_version integer GENERATED ALWAYS AS ((body->>'docVersion')::integer) STORED NOT NULL,
 author_id text GENERATED ALWAYS AS (body->>'authorId') STORED NOT NULL,
 at text GENERATED ALWAYS AS (body->>'at') STORED NOT NULL,
 sealed_at text GENERATED ALWAYS AS (body->>'sealedAt') STORED,
 data jsonb GENERATED ALWAYS AS (body->'data') STORED
);
CREATE INDEX IF NOT EXISTS revisions_doc_at ON revisions(doc_id,at DESC,doc_version DESC,id DESC);
CREATE TABLE IF NOT EXISTS publishes (
 id text PRIMARY KEY, body jsonb NOT NULL CHECK(body->>'siteVersion'=id),
 site_version integer GENERATED ALWAYS AS ((body->>'siteVersion')::integer) STORED UNIQUE NOT NULL,
 kind text GENERATED ALWAYS AS (body->>'kind') STORED NOT NULL CHECK(kind IN ('publish','unpublish','schedule','restore','rebuild')),
 manifest jsonb GENERATED ALWAYS AS (body->'manifest') STORED NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
 id text PRIMARY KEY CHECK(id='published'), body jsonb NOT NULL,
 site_version integer GENERATED ALWAYS AS ((body->>'siteVersion')::integer) STORED NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id text PRIMARY KEY, body jsonb NOT NULL CHECK(body->>'id'=id),
 at text GENERATED ALWAYS AS (body->>'at') STORED NOT NULL,
 actor_id text GENERATED ALWAYS AS (body->>'actorId') STORED NOT NULL,
 action text GENERATED ALWAYS AS (body->>'action') STORED NOT NULL,
 collection text GENERATED ALWAYS AS (body->>'collection') STORED,
 doc_id text GENERATED ALWAYS AS (body->>'docId') STORED
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_actor_at ON audit(actor_id,at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_action_at ON audit(action,at DESC,id DESC);
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, body jsonb NOT NULL CHECK(body->>'id'=id),
 username text GENERATED ALWAYS AS (body->>'username') STORED NOT NULL,
 username_key text NOT NULL UNIQUE,
 role text GENERATED ALWAYS AS (body->>'role') STORED NOT NULL CHECK(role IN ('Owner','Admin','Editor','Contributor','Viewer')),
 active boolean GENERATED ALWAYS AS ((body->>'active')::boolean) STORED NOT NULL
);
-- JS toLowerCase is the Store's username canonicalization rule; supplied on write.
CREATE TABLE IF NOT EXISTS sessions (
 id text PRIMARY KEY, body jsonb NOT NULL CHECK(body->>'hash'=id),
 user_id text GENERATED ALWAYS AS (body->>'userId') STORED NOT NULL,
 expires_at text GENERATED ALWAYS AS (body->>'expiresAt') STORED NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (id text PRIMARY KEY, body jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS meta (id text PRIMARY KEY, body jsonb NOT NULL);

CREATE OR REPLACE FUNCTION protect_cms_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cannot delete retained history'; END IF;
 IF OLD.body=NEW.body THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME<>'revisions' THEN RAISE EXCEPTION 'Cannot modify immutable history'; END IF;
 IF OLD.body->>'sealedAt' IS NOT NULL THEN RAISE EXCEPTION 'Cannot modify sealed revision'; END IF;
 IF NEW.body - 'sealedAt'=OLD.body AND NEW.body->>'sealedAt' IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.body->>'docId'<>OLD.body->>'docId' OR NEW.body->>'collection'<>OLD.body->>'collection'
 OR NEW.body->>'authorId'<>OLD.body->>'authorId'
 OR (NEW.body->>'docVersion')::integer <= (OLD.body->>'docVersion')::integer
 THEN RAISE EXCEPTION 'Revision identity or docVersion is invalid'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS retain_history ON revisions;
CREATE TRIGGER retain_history BEFORE UPDATE OR DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION protect_cms_history();
DROP TRIGGER IF EXISTS retain_history ON audit;
CREATE TRIGGER retain_history BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION protect_cms_history();
DROP TRIGGER IF EXISTS retain_history ON publishes;
CREATE TRIGGER retain_history BEFORE UPDATE OR DELETE ON publishes FOR EACH ROW EXECUTE FUNCTION protect_cms_history();
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
