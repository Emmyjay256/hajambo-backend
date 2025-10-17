-- Users (for auth)
CREATE TABLE IF NOT EXISTS app_user (
  id           BIGSERIAL PRIMARY KEY,
  phone        TEXT UNIQUE,             -- optional
  email        TEXT UNIQUE,             -- optional
  username     TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_user_username ON app_user (username);
