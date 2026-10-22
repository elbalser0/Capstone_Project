-- WARNING: Deletes all data from the listed tables and preserves table definitions.
-- Run only when intentionally resetting data.
BEGIN;
TRUNCATE TABLE
    public.observation_answer,
    public.forwarded_observation,
    public.observation_request,
    public.observer_match,
    public.proposed_date,
    public.meeting_time,
    public.eval_due,
    public.kpi_result,
    public.survey_response,
    public.notification,
    public.alert,
    public.observation,
    public.template_question,
    public.template_version,
    public.sign_up,
    public.section,
    public.eval_cycle,
    public.professor,
    public.ac_member,
    public.course,
    public.term,
    public.department
RESTART IDENTITY;
COMMIT;
