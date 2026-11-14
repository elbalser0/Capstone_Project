import { Readable, Transform } from 'node:stream';
import type { Request } from 'express';
import { ApiError } from '../middleware/error.middleware.js';

// Reads a multipart/form-data request, refusing it with 413 once it passes maxBytes.
// Bytes are counted as they arrive too, since a chunked request has no Content-Length.
export async function readMultipart(req: Request, maxBytes: number, tooLarge: () => ApiError, unreadable: () => ApiError) {
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) throw tooLarge();
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  let received = 0;
  let overLimit = false;
  const limited = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      if (received > maxBytes) {
        overLimit = true;
        req.unpipe(limited);
        req.resume(); // drain the rest so the client can finish sending and read the 413
        done(tooLarge());
        return;
      }
      done(null, chunk);
    },
  });
  req.on('error', (error) => limited.destroy(error));
  req.pipe(limited);
  try {
    return await new Request('http://form.local/', {
      method: 'POST', headers, body: Readable.toWeb(limited) as ReadableStream, duplex: 'half',
    } as RequestInit).formData();
  } catch {
    throw overLimit ? tooLarge() : unreadable();
  }
}
