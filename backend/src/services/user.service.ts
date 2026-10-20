export type Role = 'FACULTY' | 'AC';

export interface AuthUser {
  netid: string;
  email: string;
  roles: Role[];
}

// TEMPORARY: demo accounts until the PostgreSQL database is ready.
// Every user is FACULTY; AC members also have AC (this is what the AC/Faculty toggle uses).
const DEMO_USERS: AuthUser[] = [
  { netid: 'mxl210001', email: 'maya.lin@demo.edu', roles: ['FACULTY'] },
  { netid: 'exr210002', email: 'elena.ruiz@demo.edu', roles: ['FACULTY'] },
  { netid: 'lxc210003', email: 'linda.chen@demo.edu', roles: ['FACULTY', 'AC'] },
];

export async function findUserByEmail(email: string): Promise<AuthUser | undefined> {
  return DEMO_USERS.find((user) => user.email === email.toLowerCase());
}