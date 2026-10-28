CREATE TYPE rental_status AS ENUM ('ACTIVE', 'RETURNED');

CREATE TABLE rentals (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: users and copies with rental history can't be deleted
  user_id     UUID          NOT NULL REFERENCES users (id)  ON DELETE RESTRICT,
  copy_id     UUID          NOT NULL REFERENCES copies (id) ON DELETE RESTRICT,
  rented_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  due_at      TIMESTAMPTZ   NOT NULL,
  returned_at TIMESTAMPTZ,
  status      rental_status NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT rentals_due_after_rented CHECK (due_at > rented_at),
  -- A rental is RETURNED exactly when it has a return date: no half states
  CONSTRAINT rentals_returned_consistency
    CHECK ((status = 'RETURNED') = (returned_at IS NOT NULL))
);

-- THE key invariant: a copy can have at most ONE active rental.
-- "Partial": it only indexes ACTIVE rows, so any number of RETURNED rentals
-- (the history) can share the same copy.
CREATE UNIQUE INDEX rentals_one_active_per_copy ON rentals (copy_id) WHERE status = 'ACTIVE';

-- "My rentals" and the per-user limit count
CREATE INDEX rentals_user_idx ON rentals (user_id, rented_at DESC);
-- Foreign key indexes are not automatic: this one serves the copy's history
CREATE INDEX rentals_copy_idx ON rentals (copy_id);