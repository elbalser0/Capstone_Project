import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Reads the service-account key file named in GOOGLE_APPLICATION_CREDENTIALS (.env).
initializeApp({ credential: applicationDefault() });

export const firebaseAuth = getAuth();