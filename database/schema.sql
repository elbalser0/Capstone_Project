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
    email TEXT NOT NULL UNIQUE,
    rank TEXT NOT NULL
        CHECK (rank IN ('assistant', 'associate', 'full')),
    dept_id INTEGER NOT NULL
        REFERENCES public.department(dept_id),
    eval_interval_years INTEGER NOT NULL
        CHECK (eval_interval_years > 0),
    baseline_last_eval_term INTEGER
        REFERENCES public.term(term_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE FUNCTION public.set_professor_eval_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.eval_interval_years IS NULL THEN
        NEW.eval_interval_years :=
            CASE NEW.rank
                WHEN 'assistant' THEN 1
                WHEN 'associate' THEN 2
                WHEN 'full' THEN 2
            END;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER professor_eval_interval_default
BEFORE INSERT ON public.professor
FOR EACH ROW
EXECUTE FUNCTION public.set_professor_eval_interval();

CREATE TABLE public.ac_member (
    netid TEXT PRIMARY KEY
        REFERENCES public.professor(netid),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
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
    sent_by TEXT NOT NULL
        REFERENCES public.ac_member(netid),
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
                'no observer',
                'insufficient observers',
                'no acceptance'
            )
        ),
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_by TEXT
        REFERENCES public.ac_member(netid),
    resolved_date TIMESTAMPTZ,
    resolution_note TEXT,

    CHECK (
        (resolved_by IS NULL AND resolved_date IS NULL)
        OR
        (resolved_by IS NOT NULL AND resolved_date IS NOT NULL)
    ),

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
    last_saved_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observer_signature TEXT,
    observee_signature TEXT,

    FOREIGN KEY (signup_id, observer_netid)
        REFERENCES public.observation_request(
            signup_id,
            observer_netid
        ),
    FOREIGN KEY (signup_id, scheduled_date)
        REFERENCES public.proposed_date(signup_id, date),
    CHECK (
        (observer_signature IS NULL AND observer_signed_date IS NULL)
        OR
        (observer_signature IS NOT NULL AND observer_signed_date IS NOT NULL)
    ),

    CHECK (
        (observee_signature IS NULL AND observee_signed_date IS NULL)
        OR
        (observee_signature IS NOT NULL AND observee_signed_date IS NOT NULL)
    ),
    CHECK (
        status <> 'completed'
        OR (
            observer_signature IS NOT NULL
            AND observee_signature IS NOT NULL
            AND observer_signed_date IS NOT NULL
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

COMMIT;

