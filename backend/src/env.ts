import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve .env from the backend directory in both src/ and dist/ builds.
// Existing process environment variables take precedence over the file.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
