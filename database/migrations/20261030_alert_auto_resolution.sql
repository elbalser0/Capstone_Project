-- Allow system-triggered resolutions without attributing them to an AC member.
-- Open: (resolved_by, resolved_date) = (NULL, NULL)
-- Automatic: (NULL, timestamp); AC-resolved: (netid, timestamp)
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.alert'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%resolved_by IS NULL%'
          AND pg_get_constraintdef(oid) LIKE '%resolved_date%'
    LOOP
        EXECUTE format('ALTER TABLE public.alert DROP CONSTRAINT %I', constraint_record.conname);
    END LOOP;
END $$;

ALTER TABLE public.alert
    ADD CONSTRAINT alert_resolution_actor_check
    CHECK (resolved_by IS NULL OR resolved_date IS NOT NULL);
