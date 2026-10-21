--Run after loading the seed data. These values assume the highest existing IDs are department: 4, term: 12, course: 55, section: 1115.
-- Check the maximum IDs before running on an existing database.
ALTER TABLE department ALTER COLUMN dept_id    RESTART WITH 5;
ALTER TABLE term       ALTER COLUMN term_id    RESTART WITH 13;
ALTER TABLE course     ALTER COLUMN course_id  RESTART WITH 56;
ALTER TABLE section    ALTER COLUMN section_id RESTART WITH 1116;
