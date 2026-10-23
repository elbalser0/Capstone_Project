import { getPool } from '../db/pool.js';

export interface CourseRow {
  section_id: number;
  section_num: string;
  class_mode: 'in-person' | 'online';
  course_num: string;
  title: string;
  course_level: number;
  dept_name: string;
  term_id: number;
  season: 'fall' | 'spring';
  year: number;
  start_date: string;
  end_date: string;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
}

interface CourseSection {
  sectionId: string;
  label: string;
  courseNum: string;
  sectionNum: string;
  title: string;
  courseLevel: number;
  classMode: 'in-person' | 'online';
  enrollment: null;
  term: {
    termId: string;
    season: 'fall' | 'spring';
    year: number;
    label: string;
    startDate: string;
    endDate: string;
  };
  meetings: { dayOfWeek: string; startTime: string; endTime: string; room: string }[];
}

const dayNames: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

export function mapCourseRows(rows: CourseRow[]): CourseSection[] {
  const sections = new Map<number, CourseSection>();
  for (const row of rows) {
    let section = sections.get(row.section_id);
    if (!section) {
      section = {
        sectionId: String(row.section_id),
        // shortcut: the schema has a department name but no short code such as "CS".
        // Add a department code column when the catalog importer is ready.
        label: `${row.dept_name} ${row.course_num}.${row.section_num}`,
        courseNum: row.course_num,
        sectionNum: row.section_num,
        title: row.title,
        courseLevel: row.course_level,
        classMode: row.class_mode,
        // shortcut: section.enrollment is absent from the live schema; populate after a migration.
        enrollment: null,
        term: {
          termId: String(row.term_id),
          season: row.season,
          year: row.year,
          label: `${row.season === 'fall' ? 'Fall' : 'Spring'} ${row.year}`,
          startDate: row.start_date,
          endDate: row.end_date,
        },
        meetings: [],
      };
      sections.set(row.section_id, section);
    }
    if (row.day_of_week && row.start_time && row.end_time) {
      section.meetings.push({
        dayOfWeek: dayNames[row.day_of_week] ?? row.day_of_week,
        startTime: row.start_time.slice(0, 5),
        endTime: row.end_time.slice(0, 5),
        room: row.room ?? '',
      });
    }
  }
  return [...sections.values()];
}

export async function listCourses(netid: string, termId: number): Promise<CourseSection[]> {
  const { rows } = await getPool().query<CourseRow>(`
    SELECT s.section_id, s.section_num, s.class_mode,
           c.course_num, c.title, c.course_level, d.dept_name,
           t.term_id, t.season, t.year,
           t.start_date::text, t.end_date::text,
           m.day_of_week, m.start_time::text, m.end_time::text, m.room
    FROM section AS s
    JOIN course AS c ON c.course_id = s.course_id
    JOIN department AS d ON d.dept_id = c.dept_id
    JOIN term AS t ON t.term_id = s.term_id
    LEFT JOIN meeting_time AS m ON m.section_id = s.section_id
    WHERE s.instructor_id = $1 AND s.term_id = $2
    ORDER BY c.course_num, s.section_num, m.day_of_week, m.start_time
  `, [netid, termId]);
  return mapCourseRows(rows);
}
