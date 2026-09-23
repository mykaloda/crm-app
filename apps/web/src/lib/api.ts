export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:4100';

export class ApiError extends Error {
  constructor(public status: number, public body: { error?: string; message?: string | string[]; [k: string]: unknown }) {
    super(Array.isArray(body?.message) ? body.message.join('; ') : (body?.message as string) ?? body?.error ?? `HTTP ${status}`);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

/** JSON fetch against the API with cookie auth and one transparent refresh on 401. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, init, false);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body ?? {});
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const put = <T>(path: string, json: unknown = {}) => api<T>(path, { method: 'PUT', json });
export const del = <T>(path: string, json?: unknown) => api<T>(path, { method: 'DELETE', json });

export interface Me {
  id: string;
  email: string;
  role: 'USER' | 'MODERATOR' | 'ADMIN';
  locale: 'en' | 'ru';
  ageVerificationStatus: string;
  aiEnabled: boolean;
  consents: string[];
  profile: { status: string; completeness: number; missing: string[]; displayName: string | null };
  pendingDrafts: number;
  connections: { id: string; type: string; label: string; lastUsedAt: string | null; createdAt: string }[];
  subscription: { plan: string; currentPeriodEnd: string | null } | null;
  onboarding: { consent: boolean; verified: boolean; aiConnected: boolean; profileReady: boolean; nextStep: string };
}
