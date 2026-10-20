CREATE TABLE movies (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable, human-readable natural key: the seed file is matched against it
  slug         TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  overview     TEXT,
  release_year SMALLINT,
  director     TEXT,
  genres       TEXT[]      NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT movies_slug_key UNIQUE (slug),
  -- Same rule the seed validation applies: lowercase words joined by hyphens
  CONSTRAINT movies_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TYPE copy_format AS ENUM ('DVD', 'BLURAY');
-- Whether a copy is in circulation. Availability is NOT stored here:
-- it is derived from rentals, to avoid two sources of truth.
CREATE TYPE copy_status AS ENUM ('ACTIVE', 'RETIRED');

CREATE TABLE copies (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: a movie with physical copies can't be deleted by accident
  movie_id   UUID        NOT NULL REFERENCES movies (id) ON DELETE RESTRICT,
  format     copy_format NOT NULL,
  status     copy_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PostgreSQL does NOT create an index on foreign key columns automatically.
CREATE INDEX copies_movie_id_idx ON copies (movie_id);