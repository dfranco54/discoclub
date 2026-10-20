-- Supports keyset pagination: ORDER BY title, slug and (title, slug) > (...)
CREATE INDEX movies_title_slug_idx ON movies (title, slug);