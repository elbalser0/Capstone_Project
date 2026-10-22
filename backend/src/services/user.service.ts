// Shapes match the frontend's GET /api/me type (App/frontend/src/api/types.ts).
export type Rank = 'assistant' | 'associate' | 'full';
export type Role = 'AC' | 'faculty';

export interface Department {
  deptId: string;
  deptName: string;
}

export interface AuthUser {
  netid: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  rank: Rank;
  department: Department;
  // "AC" = a professor who is also an active Assessment Committee member (keeps faculty access too).
  role: Role;
}

const CS: Department = { deptId: 'CS', deptName: 'Computer Science' };

// TEMPORARY: demo accounts until the PostgreSQL database is connected.
// NetIDs match the frontend's mock data so both sides refer to the same people.
const DEMO_USERS: AuthUser[] = [
  { netid: 'mli202574', firstName: 'Maya', lastName: 'Lin', displayName: 'Dr. Maya Lin',
    email: 'maya.lin@demo.edu', rank: 'associate', department: CS, role: 'faculty' },
  { netid: 'eru150234', firstName: 'Elena', lastName: 'Ruiz', displayName: 'Dr. Elena Ruiz',
    email: 'elena.ruiz@demo.edu', rank: 'associate', department: CS, role: 'faculty' },
  { netid: 'lch216317', firstName: 'Linda', lastName: 'Chen', displayName: 'Dr. Linda Chen',
    email: 'linda.chen@demo.edu', rank: 'associate', department: CS, role: 'AC' },
];

export async function findUserByEmail(email: string): Promise<AuthUser | undefined> {
  return DEMO_USERS.find((user) => user.email === email.toLowerCase());
}