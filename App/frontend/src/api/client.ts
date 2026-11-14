import type { ApiErrorBody } from './types';

const BASE = '/api';

/** A failed API call, carrying the backend's {"error":{"code","message"}} body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;

/** The auth layer registers how to get the current ID token (demo token or Firebase ID token). */
export function setTokenProvider(provider: () => Promise<string | null>) {
  tokenProvider = provider;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  /** Plain objects are sent as JSON; FormData is sent as multipart (file uploads). */
  body?: unknown;
}

export async function api<T>(path: string, { method = 'GET', query, body }: RequestOptions = {}): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = await tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

/** AC-only binary endpoint. Never navigate directly: the bearer token must accompany the request. */
export async function downloadSurveyTroubleFile(cycleId: string, responseId: string): Promise<void> {
  const token = await tokenProvider();
  const res = await fetch(`${BASE}/cycles/${encodeURIComponent(cycleId)}/survey-responses/${encodeURIComponent(responseId)}/trouble-file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let error: ApiErrorBody | undefined;
    try { error = await res.json() as ApiErrorBody; } catch { /* Non-JSON error response. */ }
    throw new ApiError(res.status, error?.error?.code ?? 'HTTP_ERROR', error?.error?.message ?? `Download failed (${res.status}).`);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let name = '';
  try { name = encoded ? decodeURIComponent(encoded) : ''; } catch { /* Fall back to a known-safe name. */ }
  // Treat the server's header as untrusted: strip path segments, controls and filesystem metacharacters.
  name = name.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim().replace(/^\.+$/, '') ?? '';
  name = name.slice(0, 255) || `survey-response-${responseId}-attachment`;
  const url = URL.createObjectURL(await res.blob());
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); }
  } finally {
    URL.revokeObjectURL(url);
  }
}
