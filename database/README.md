# Database setup

This folder contains the PostgreSQL scripts for Assessment Helper.

## Files

- schema.sql: Creates all 22 tables, constraints, and the professor
  evaluation interval function and trigger.
- checkDatabase.sql: Displays table names and column information.
- reset_identity_after_seed.sql: Sets the next generated IDs after
  loading the matching seed dataset.
- clear_data.sql: Deletes table data and resets identity counters
  while preserving the table definitions.

## Setup order

1. Connect to an empty PostgreSQL database.
2. Run schema.sql.
3. Load the sample data using Samuel's data-generation/loading script.
4. The seed loader automatically updates the ID counters after loading.
   If it cannot reset them because of insufficient permissions, it prints
   ALTER TABLE ... RESTART WITH commands. The table owner should run
   those exact commands after loading, before the app adds more data.
6. Run checkDatabase.sql to inspect the schema.

Do not rerun schema.sql on a database where these tables already exist.

## Resetting data

clear_data.sql deletes data. It is not part of normal setup.
Coordinate with the team before using it on the shared database.

## Migrations

- `migrations/20261030_alert_auto_resolution.sql`: Apply to an existing database
  to allow automatic alert resolution without attributing it to an AC member.
  New databases get this constraint from `schema.sql`.

## Connection details

Obtain database credentials privately from the database team.
Do not commit passwords, connection strings, or .env files.
