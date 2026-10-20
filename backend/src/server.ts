import './env.js';
import { app } from './app.js';

const rawPort = process.env.PORT ?? '3000';
const port = Number(rawPort);
if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const server = app.listen(port, () => {
  console.log(`Assessment Helper API listening on port ${port}`);
});
server.on('error', (error) => {
  console.error('Failed to start Assessment Helper API:', error.message);
  process.exitCode = 1;
});
