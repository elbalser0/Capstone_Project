BEGIN;

CREATE TABLE public.department (
    dept_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dept_name TEXT NOT NULL
);

CREATE TABLE public.term (
    term_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    season TEXT NOT NULL
        CHECK (season IN ('fall', 'spring')),
    year INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    UNIQUE (season, year),
    CHECK (end_date >= start_date)
);

CREATE TABLE public.professor (
    netid TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    rank TEXT NOT NULL
        CHECK (rank IN ('assistant', 'associate', 'full')),
    dept_id INTEGER NOT NULL
        REFERENCES public.department(dept_id),
    eval_interval_years INTEGER NOT NULL
        CHECK (eval_interval_years > 0),
    baseline_last_eval_term INTEGER
        REFERENCES public.term(term_id),
    start_term INTEGER
        REFERENCES public.term(term_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX professor_email_lower_unique
ON public.professor (LOWER(email));

CREATE OR REPLACE FUNCTION public.set_professor_eval_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.eval_interval_years :=
        CASE NEW.rank
            WHEN 'assistant' THEN 1
            WHEN 'associate' THEN 2
            WHEN 'full' THEN 2
        END;

    RETURN NEW;
END;
$$;

CREATE TRIGGER professor_eval_interval_default
BEFORE INSERT OR UPDATE OF rank
ON public.professor
FOR EACH ROW
EXECUTE FUNCTION public.set_professor_eval_interval();


CREATE TABLE public.ac_member (
    netid TEXT PRIMARY KEY
        REFERENCES public.professor(netid),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.survey_attachment (
    attachment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    file_data BYTEA NOT NULL,

    uploaded_by TEXT NOT NULL
        REFERENCES public.professor(netid),

    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT survey_attachment_file_size_matches
        CHECK (file_size = octet_length(file_data))
);

CREATE TABLE public.course (
    course_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dept_id INTEGER NOT NULL
        REFERENCES public.department(dept_id),
    course_num TEXT NOT NULL,
    title TEXT NOT NULL,
    course_level INTEGER NOT NULL
);

CREATE TABLE public.section (
    section_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id INTEGER NOT NULL
        REFERENCES public.course(course_id),
    term_id INTEGER NOT NULL
        REFERENCES public.term(term_id),
    section_num TEXT NOT NULL,
    instructor_id TEXT NOT NULL
        REFERENCES public.professor(netid),
    class_mode TEXT NOT NULL
        CHECK (class_mode IN ('online', 'in-person')),

    UNIQUE (course_id, term_id, section_num)
);

CREATE TABLE public.meeting_time (
    section_id INTEGER NOT NULL
        REFERENCES public.section(section_id),
    day_of_week TEXT NOT NULL
        CHECK (
            day_of_week IN (
                'monday',
                'tuesday',
                'wednesday',
                'thursday',
                'friday',
                'saturday',
                'sunday'
            )
        ),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room TEXT,

    PRIMARY KEY (section_id, day_of_week, start_time),
    CHECK (end_time > start_time)
);

CREATE TABLE public.eval_cycle (
    cycle_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    term_id INTEGER NOT NULL UNIQUE
        REFERENCES public.term(term_id),
    started_by TEXT NOT NULL
        REFERENCES public.ac_member(netid),
    start_date DATE NOT NULL,
    signup_deadline DATE NOT NULL,
    observation_deadline DATE NOT NULL,
    feedback_deadline DATE NOT NULL,

    CHECK (start_date <= signup_deadline),
    CHECK (signup_deadline <= observation_deadline),
    CHECK (observation_deadline <= feedback_deadline)
);

CREATE TABLE public.eval_due (
    cycle_id INTEGER NOT NULL
        REFERENCES public.eval_cycle(cycle_id),
    netid TEXT NOT NULL
        REFERENCES public.professor(netid),
    due_status TEXT NOT NULL
        CHECK (due_status IN ('overdue', 'due')),

    PRIMARY KEY (cycle_id, netid)
);

CREATE TABLE public.sign_up (
    signup_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cycle_id INTEGER NOT NULL
        REFERENCES public.eval_cycle(cycle_id),
    observee_netid TEXT NOT NULL
        REFERENCES public.professor(netid),
    section_id INTEGER NOT NULL
        REFERENCES public.section(section_id),
    submit_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (cycle_id, observee_netid)
);

CREATE TABLE public.observer_match (
    signup_id INTEGER NOT NULL
        REFERENCES public.sign_up(signup_id),
    observer_netid TEXT NOT NULL
        REFERENCES public.professor(netid),
    generated_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    round_no INTEGER NOT NULL DEFAULT 1
        CHECK (round_no >= 1),

    PRIMARY KEY (signup_id, observer_netid)
);

CREATE TABLE public.observation_request (
    signup_id INTEGER NOT NULL,
    observer_netid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'accepted',
                'declined',
                'cancelled',
                'expired'
            )
        ),
    sent_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_date TIMESTAMPTZ,

    PRIMARY KEY (signup_id, observer_netid),

    FOREIGN KEY (signup_id, observer_netid)
        REFERENCES public.observer_match(
            signup_id,
            observer_netid
        ),

    CHECK (
        responded_date IS NULL
        OR responded_date >= sent_date
    )
);

CREATE TABLE public.proposed_date (
    signup_id INTEGER NOT NULL
        REFERENCES public.sign_up(signup_id),
    date DATE NOT NULL,

    PRIMARY KEY (signup_id, date)
);

CREATE TABLE public.notification (
    notification_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cycle_id INTEGER NOT NULL
        REFERENCES public.eval_cycle(cycle_id),
    recipient_netid TEXT NOT NULL
        REFERENCES public.professor(netid),
    sent_by TEXT 
        REFERENCES public.professor(netid),
    notif_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    sent_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.alert (
    alert_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    signup_id INTEGER NOT NULL
        REFERENCES public.sign_up(signup_id),
    alert_type TEXT NOT NULL
        CHECK (
            alert_type IN (
                'no_observer',
                'insufficient_observers',
                'no_acceptance'
            )
        ),
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_by TEXT
        REFERENCES public.ac_member(netid),
    resolved_date TIMESTAMPTZ,
    resolution_note TEXT,

    -- A null resolver with a resolution date means the system resolved the alert.
    CONSTRAINT alert_resolution_actor_check
        CHECK (resolved_by IS NULL OR resolved_date IS NOT NULL),

    CHECK (
        resolved_date IS NULL
        OR resolved_date >= created_date
    )
);

CREATE TABLE public.template_version (
    version_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_no INTEGER NOT NULL UNIQUE
        CHECK (version_no > 0),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'live', 'retired')),
    change_note TEXT,
    created_by TEXT NOT NULL
        REFERENCES public.ac_member(netid),
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_date TIMESTAMPTZ,

    CHECK (
        published_date IS NULL
        OR published_date >= created_date
    ),

    CHECK (
        status <> 'live'
        OR published_date IS NOT NULL
    )
);

CREATE UNIQUE INDEX template_version_one_live_unique
ON public.template_version (status)
WHERE status = 'live';

CREATE TABLE public.template_question (
    question_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_id INTEGER NOT NULL
        REFERENCES public.template_version(version_id),
    order_no INTEGER NOT NULL
        CHECK (order_no > 0),
    title TEXT NOT NULL,
    wording TEXT NOT NULL,
    rating_min INTEGER NOT NULL,
    rating_max INTEGER NOT NULL,
    min_label TEXT,
    max_label TEXT,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,

    UNIQUE (version_id, order_no),
    CHECK (rating_max >= rating_min)
);

CREATE TABLE public.observation (
    observation_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    signup_id INTEGER NOT NULL UNIQUE
        REFERENCES public.sign_up(signup_id),

    observer_netid TEXT NOT NULL
        REFERENCES public.professor(netid),

    version_id INTEGER NOT NULL
        REFERENCES public.template_version(version_id),

    scheduled_date DATE NOT NULL,

    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (
            status IN (
                'scheduled',
                'completed',
                'not_completed'
            )
        ),

    observee_signed_date TIMESTAMPTZ,
    observer_signed_date TIMESTAMPTZ,
    reason_not_completed TEXT,
    issue_file_key TEXT,
    other_comments TEXT,
    last_saved_date TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (signup_id, observer_netid)
        REFERENCES public.observation_request(
            signup_id,
            observer_netid
        ),

    FOREIGN KEY (signup_id, scheduled_date)
        REFERENCES public.proposed_date(signup_id, date),

    CONSTRAINT observation_completed_requires_signed_dates
        CHECK (
            status <> 'completed'
            OR (
                observer_signed_date IS NOT NULL
                AND observee_signed_date IS NOT NULL
            )
        ),

    CHECK (
        status <> 'not_completed'
        OR NULLIF(BTRIM(reason_not_completed), '') IS NOT NULL
    )
);

CREATE TABLE public.observation_answer (
    observation_id INTEGER NOT NULL
        REFERENCES public.observation(observation_id),
    question_id INTEGER NOT NULL
        REFERENCES public.template_question(question_id),
    rating INTEGER,
    comment TEXT,

    PRIMARY KEY (observation_id, question_id)
);

-- Validate the question and rating for each observation answer.
CREATE OR REPLACE FUNCTION public.validate_observation_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    observation_version INTEGER;
    question_version INTEGER;
    minimum_rating INTEGER;
    maximum_rating INTEGER;
BEGIN
    SELECT version_id
    INTO observation_version
    FROM public.observation
    WHERE observation_id = NEW.observation_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Observation % does not exist',
            NEW.observation_id;
    END IF;

    SELECT version_id, rating_min, rating_max
    INTO question_version, minimum_rating, maximum_rating
    FROM public.template_question
    WHERE question_id = NEW.question_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question % does not exist',
            NEW.question_id;
    END IF;

    IF question_version IS DISTINCT FROM observation_version THEN
        RAISE EXCEPTION
            'Question % does not belong to observation % template version',
            NEW.question_id, NEW.observation_id;
    END IF;

    -- Allow an unanswered rating while saving a draft.
    IF NEW.rating IS NOT NULL THEN
        IF (minimum_rating IS NOT NULL
            AND NEW.rating < minimum_rating)
           OR
           (maximum_rating IS NOT NULL
            AND NEW.rating > maximum_rating)
        THEN
            RAISE EXCEPTION
                'Rating % is outside the allowed range % to % for question %',
                NEW.rating, minimum_rating, maximum_rating,
                NEW.question_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS observation_answer_validation
ON public.observation_answer;

CREATE TRIGGER observation_answer_validation
BEFORE INSERT OR UPDATE
ON public.observation_answer
FOR EACH ROW
EXECUTE FUNCTION public.validate_observation_answer();

CREATE TABLE public.forwarded_observation (
    forward_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id INTEGER NOT NULL
        REFERENCES public.observation(observation_id),
    recipient_email TEXT NOT NULL,
    shared_by TEXT NOT NULL
        REFERENCES public.ac_member(netid),
    shared_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    link_token TEXT NOT NULL UNIQUE
);

CREATE TABLE public.survey_response (
    response_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cycle_id INTEGER NOT NULL
        REFERENCES public.eval_cycle(cycle_id),
    respondent_id TEXT NOT NULL
        REFERENCES public.professor(netid),
    respondent_role TEXT NOT NULL
        CHECK (respondent_role IN ('observer', 'observee')),
    process_ok BOOLEAN NOT NULL,
    difficulties TEXT,
    additional_feedback TEXT,
    trouble_file_key TEXT,
    submitted_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (cycle_id, respondent_id, respondent_role)
);

CREATE TABLE public.kpi_result (
    cycle_id INTEGER NOT NULL
        REFERENCES public.eval_cycle(cycle_id),
    kpi_code TEXT NOT NULL,
    numerator NUMERIC NOT NULL
        CHECK (numerator >= 0),
    denominator NUMERIC
        CHECK (denominator >= 0),
    kpi_value NUMERIC,
    computed_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (cycle_id, kpi_code)
);
-- 1. A sign-up must use a section taught by the observee.
ALTER TABLE public.section
    ADD CONSTRAINT section_id_instructor_unique
    UNIQUE (section_id, instructor_id);

ALTER TABLE public.sign_up
    ADD CONSTRAINT signup_section_owner_fk
    FOREIGN KEY (section_id, observee_netid)
    REFERENCES public.section (section_id, instructor_id);


-- 2. Validate the section's term when a sign-up is created or changed.
-- Also prevent changing the observee to an existing matched observer.
CREATE OR REPLACE FUNCTION public.validate_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    section_term INTEGER;
    cycle_term INTEGER;
BEGIN
    SELECT term_id
    INTO section_term
    FROM public.section
    WHERE section_id = NEW.section_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Section % does not exist',
            NEW.section_id;
    END IF;

    SELECT term_id
    INTO cycle_term
    FROM public.eval_cycle
    WHERE cycle_id = NEW.cycle_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Evaluation cycle % does not exist',
            NEW.cycle_id;
    END IF;

    IF section_term IS DISTINCT FROM cycle_term THEN
        RAISE EXCEPTION
            'The section and evaluation cycle must belong to the same term';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.observer_match
        WHERE signup_id = NEW.signup_id
          AND observer_netid = NEW.observee_netid
    ) THEN
        RAISE EXCEPTION
            'Professor % cannot observe their own sign-up',
            NEW.observee_netid;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signup_validation
ON public.sign_up;

CREATE TRIGGER signup_validation
BEFORE INSERT OR UPDATE OF section_id, cycle_id, observee_netid
ON public.sign_up
FOR EACH ROW
EXECUTE FUNCTION public.validate_signup();


-- 3. Reject a professor being matched as their own observer.
CREATE OR REPLACE FUNCTION public.prevent_self_observation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    signup_observee TEXT;
BEGIN
    SELECT observee_netid
    INTO signup_observee
    FROM public.sign_up
    WHERE signup_id = NEW.signup_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sign-up % does not exist',
            NEW.signup_id;
    END IF;

    IF NEW.observer_netid = signup_observee THEN
        RAISE EXCEPTION
            'Professor % cannot observe their own sign-up',
            NEW.observer_netid;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS observer_match_no_self_observation
ON public.observer_match;

CREATE TRIGGER observer_match_no_self_observation
BEFORE INSERT OR UPDATE OF signup_id, observer_netid
ON public.observer_match
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_observation();

CREATE INDEX IF NOT EXISTS section_instructor_idx
    ON public.section (instructor_id);

CREATE INDEX IF NOT EXISTS section_term_idx
    ON public.section (term_id);

CREATE INDEX IF NOT EXISTS observer_match_observer_idx
    ON public.observer_match (observer_netid);

CREATE INDEX IF NOT EXISTS observation_observer_idx
    ON public.observation (observer_netid);

-- Lock completed observations
CREATE OR REPLACE FUNCTION public.lock_completed_observation()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    IF OLD.status = 'completed' THEN
        RAISE EXCEPTION 'Observation % is completed and cannot be changed', OLD.observation_id;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS observation_completed_lock ON public.observation;
CREATE TRIGGER observation_completed_lock
BEFORE UPDATE OR DELETE ON public.observation
FOR EACH ROW EXECUTE FUNCTION public.lock_completed_observation();

-- Lock answers of completed observations
CREATE OR REPLACE FUNCTION public.lock_completed_observation_answer()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
    obs_id INTEGER;
    obs_status TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        obs_id := NEW.observation_id;
    ELSE
        obs_id := OLD.observation_id;
    END IF;

    SELECT status INTO obs_status
    FROM public.observation
    WHERE observation_id = obs_id;

    IF obs_status = 'completed' THEN
        RAISE EXCEPTION 'Observation % is completed; its answers cannot be changed', obs_id;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.observation_id IS DISTINCT FROM OLD.observation_id THEN
        SELECT status INTO obs_status
        FROM public.observation
        WHERE observation_id = NEW.observation_id;
        IF obs_status = 'completed' THEN
            RAISE EXCEPTION 'Observation % is completed; its answers cannot be changed', NEW.observation_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS observation_answer_completed_lock ON public.observation_answer;
CREATE TRIGGER observation_answer_completed_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.observation_answer
FOR EACH ROW EXECUTE FUNCTION public.lock_completed_observation_answer();

-- Block a section term change that would break the term match
CREATE OR REPLACE FUNCTION public.protect_section_term()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    IF NEW.term_id IS DISTINCT FROM OLD.term_id AND EXISTS (
        SELECT 1
        FROM public.sign_up s
        JOIN public.eval_cycle ec ON ec.cycle_id = s.cycle_id
        WHERE s.section_id = NEW.section_id
          AND ec.term_id IS DISTINCT FROM NEW.term_id
    ) THEN
        RAISE EXCEPTION 'Cannot change term of section %: it has sign-ups in an evaluation cycle of another term', NEW.section_id;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS section_term_protect ON public.section;
CREATE TRIGGER section_term_protect
BEFORE UPDATE OF term_id ON public.section
FOR EACH ROW EXECUTE FUNCTION public.protect_section_term();

-- Block a cycle term change that would break the term match
CREATE OR REPLACE FUNCTION public.protect_cycle_term()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    IF NEW.term_id IS DISTINCT FROM OLD.term_id AND EXISTS (
        SELECT 1
        FROM public.sign_up s
        JOIN public.section sec ON sec.section_id = s.section_id
        WHERE s.cycle_id = NEW.cycle_id
          AND sec.term_id IS DISTINCT FROM NEW.term_id
    ) THEN
        RAISE EXCEPTION 'Cannot change term of cycle %: it has sign-ups for a section of another term', NEW.cycle_id;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cycle_term_protect ON public.eval_cycle;
CREATE TRIGGER cycle_term_protect
BEFORE UPDATE OF term_id ON public.eval_cycle
FOR EACH ROW EXECUTE FUNCTION public.protect_cycle_term();

COMMIT;

