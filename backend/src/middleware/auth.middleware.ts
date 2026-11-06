import type { NextFunction, Request, Response } from 'express';
import { firebaseAuth } from '../config/firebase.js';
import { findAccountByEmail, type Account, type AuthUser } from '../services/user.service.js';
import { ApiError } from './error.middleware.js';

declare global {
  namespace Express {
    interface Request {
      // The signed-in account: professor, admin, or both. Set by authenticate.
      account?: Account;
      // The signed-in professor. Missing for an admin who is not a professor.
      user?: AuthUser;
    }
  }
}

// Verifies the Firebase token and finds the active professor and/or admin for its email.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    next(new ApiError(401, 'UNAUTHENTICATED', 'Missing login token.'));
    return;
  }

  let email: string | undefined;
  try {
    const decoded = await firebaseAuth.verifyIdToken(header.slice('Bearer '.length));
    if (!decoded.email || !decoded.email_verified) {
      next(new ApiError(401, 'UNVERIFIED_EMAIL', 'Sign in with a verified email address.'));
      return;
    }
    email = decoded.email;
  } catch {
    next(new ApiError(401, 'INVALID_TOKEN', 'The login token is invalid or has expired.'));
    return;
  }

  const account = await findAccountByEmail(email);
  if (!account.professor && !account.admin) {
    next(new ApiError(403, 'NOT_A_PROFESSOR', 'This account is not linked to a professor.'));
    return;
  }

  req.account = account;
  req.user = account.professor;
  next();
}

// Use after authenticate: only professors may continue.
export function requireProfessor(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    next(new ApiError(403, 'NOT_A_PROFESSOR', 'This account is not linked to a professor.'));
    return;
  }
  next();
}

// Guard 1: is this a real, logged-in professor?
export const requireLogin = [authenticate, requireProfessor];

// Use after authenticate: only active admins may continue.
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.account?.admin) {
    next(new ApiError(403, 'FORBIDDEN', 'Only admins can do this.'));
    return;
  }
  next();
}

// Guard 2: is this professor on the Assessment Committee? Use after requireLogin.
export function requireAC(req: Request, _res: Response, next: NextFunction) {
   if (req.user?.role !== 'AC') {
    next(new ApiError(403, 'FORBIDDEN', 'Only Assessment Committee members can do this.'));
    return;
  }
  next();
}