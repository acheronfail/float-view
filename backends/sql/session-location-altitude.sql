ALTER TABLE location ADD COLUMN altitude_m REAL CHECK (
  altitude_m IS NULL OR (
    typeof(altitude_m) = 'real'
    AND altitude_m BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308
  )
);
