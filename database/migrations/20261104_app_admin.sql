-- Add admin accounts to an existing database. Safe to run more than once.
-- New databases get this table from schema.sql.
CREATE TABLE IF NOT EXISTS public.app_admin (
    admin_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS app_admin_email_lower_unique
ON public.app_admin (LOWER(email));

-- Add the first admin. Use the email address they sign in with on Firebase.
-- INSERT INTO public.app_admin (email, first_name, last_name)
-- VALUES ('first.admin@example.edu', 'First', 'Admin');
