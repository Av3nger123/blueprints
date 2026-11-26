-- Illustrative PostgreSQL schema for the auth data model. Adapt types and naming to your ORM's migrations.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id                  uuid PRIMARY KEY,
  email               citext NOT NULL UNIQUE,              -- case-insensitive uniqueness (D9)
  email_verified_at   timestamptz,
  password_hash       text NOT NULL,                       -- PHC string: $argon2id$v=19$m=19456,t=2,p=1$...
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id_hash             char(64) PRIMARY KEY,                -- sha256(raw session id), never the raw id
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  ip                  text,
  user_agent          text
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE one_time_tokens (
  token_hash  char(64) PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX one_time_tokens_user_purpose_idx ON one_time_tokens (user_id, purpose);

CREATE TABLE roles       (id serial PRIMARY KEY, name text NOT NULL UNIQUE, description text);
CREATE TABLE permissions (id serial PRIMARY KEY, name text NOT NULL UNIQUE, description text); -- 'resource:action'
CREATE TABLE role_permissions (
  role_id       int NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id int NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    int  NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

INSERT INTO roles (name, description) VALUES ('user', 'Granted at registration'), ('admin', 'Administrators');
-- No default admin account. Bootstrap the first admin with a one-off CLI command or single-use invite.
