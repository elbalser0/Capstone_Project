BEGIN;

ALTER TABLE public.observation
    DROP CONSTRAINT IF EXISTS observation_signup_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS observation_one_active_per_signup
    ON public.observation (signup_id)
    WHERE status <> 'not_completed';

COMMIT;
