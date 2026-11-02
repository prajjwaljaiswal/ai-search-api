CREATE SCHEMA IF NOT EXISTS codehence;
REVOKE ALL ON SCHEMA codehence FROM PUBLIC;

CREATE TABLE IF NOT EXISTS codehence.stores(id TEXT PRIMARY KEY,name TEXT NOT NULL,currency TEXT NOT NULL,search_hash TEXT UNIQUE NOT NULL,write_hash TEXT UNIQUE NOT NULL,origins TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codehence.products(store_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(store_id,id),FOREIGN KEY(store_id) REFERENCES codehence.stores(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codehence.embeddings(store_id TEXT NOT NULL,product_id TEXT NOT NULL,model TEXT NOT NULL,content_hash TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(store_id,product_id,model),FOREIGN KEY(store_id,product_id) REFERENCES codehence.products(store_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codehence.accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codehence.sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires BIGINT NOT NULL,FOREIGN KEY(account_id) REFERENCES codehence.accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codehence.store_access(store_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,search_key TEXT NOT NULL,FOREIGN KEY(store_id) REFERENCES codehence.stores(id) ON DELETE CASCADE,FOREIGN KEY(account_id) REFERENCES codehence.accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS codehence.request_limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS codehence.index_leases(id TEXT PRIMARY KEY,token TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON codehence.sessions(expires);
CREATE INDEX IF NOT EXISTS store_access_account_idx ON codehence.store_access(account_id);
CREATE INDEX IF NOT EXISTS request_limits_expiry_idx ON codehence.request_limits(expires);

CREATE TABLE IF NOT EXISTS codehence.schema_migrations(id INTEGER PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO codehence.schema_migrations(id) VALUES(1) ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON SCHEMA codehence FROM anon; REVOKE ALL ON ALL TABLES IN SCHEMA codehence FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON SCHEMA codehence FROM authenticated; REVOKE ALL ON ALL TABLES IN SCHEMA codehence FROM authenticated; END IF;
END $$;
