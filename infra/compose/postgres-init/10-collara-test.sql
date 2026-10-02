-- Runs once, when the postgres container initialises an empty data volume (as POSTGRES_USER).
-- The `collara` database itself comes from POSTGRES_DB.
CREATE DATABASE collara_test OWNER collara;
