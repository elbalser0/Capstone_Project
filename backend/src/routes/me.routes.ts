import { Router } from 'express';
import type { Account } from '../services/user.service.js';

export const meRouter = Router();

// A professor gets their profile plus isAdmin. An admin who is not a professor
// has no netid, rank or department and gets role "admin".
export function meResponse(account: Account) {
  const { professor, admin } = account;
  if (professor) return { ...professor, isAdmin: Boolean(admin) };
  return {
    netid: null,
    firstName: admin!.firstName,
    lastName: admin!.lastName,
    displayName: `${admin!.firstName} ${admin!.lastName}`,
    email: admin!.email,
    rank: null,
    department: null,
    role: 'admin' as const,
    isAdmin: true,
  };
}

// GET /api/me -> who is logged in and which roles they have.
// Mounted after authenticate only, so admins who are not professors can call it.
meRouter.get('/', (req, res) => {
  res.status(200).json(meResponse(req.account!));
});
