import type { NextFunction, Request, Response } from 'express';
import { firebaseAuth } from '../config/firebase.js';
import { findUserByEmail, type AuthUser } from '../services/user.service.js';
import { ApiError } from './error.middleware.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Guard 1: is this a real, logged-in professor?
export async function requireLogin(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    next(new ApiError(401, 'UNAUTHENTICATED', 'Missing login token.'));
    return;
  }

  let email: string | undefined;
  try {
    const decoded = await firebaseAuth.verifyIdToken(header.slice('Bearer '.length));
    email = decoded.email;
  } catch {
    next(new ApiError(401, 'INVALID_TOKEN', 'The login token is invalid or has expired.'));
    return;
  }

  const user = email ? await findUserByEmail(email) : undefined;
  if (!user) {
    next(new ApiError(403, 'NOT_A_PROFESSOR', 'This account is not linked to a professor.'));
    return;
  }

  req.user = user;
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