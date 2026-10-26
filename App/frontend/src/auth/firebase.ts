import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserSessionPersistence, getAuth, setPersistence, type Auth } from 'firebase/auth';

const CONFIG_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
} as const;

/** The Auth instance for VITE_FIREBASE_* settings; throws if a required one is missing. */
export function getFirebaseAuth(): Auth {
  const env = import.meta.env;
  const missing = Object.values(CONFIG_KEYS).filter((name) => !env[name]);
  if (missing.length) throw new Error(`Firebase sign-in is not configured. Set ${missing.join(', ')} in .env.`);

  // getApps() keeps Vite hot reloads from initializing the app twice.
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        appId: env.VITE_FIREBASE_APP_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      });
  return getAuth(app);
}

/** Keep the login per tab, like the demo session, instead of across browser restarts. */
export function setTabPersistence(auth: Auth) {
  return setPersistence(auth, browserSessionPersistence);
}
