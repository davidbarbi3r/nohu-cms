/** Appels à l'API admin du Worker (/api/admin/*, voir src/worker/index.ts). */
import type { Entry, EntryInput } from '../config';
import type { StoredValue } from '../fields';
import type { MediaUpload, PublishResult, PublishStatus } from '../protocol';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/admin${path}`, {
      credentials: 'same-origin',
      ...init,
      headers:
        init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json', ...init.headers }
          : init.headers,
    });
  } catch {
    throw new ApiError(
      'Impossible de joindre le serveur. Vérifie ta connexion internet.',
      0,
    );
  }
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: string; fields?: Record<string, string> }) | null;
  if (!response.ok) {
    throw new ApiError(
      payload?.error ?? `Erreur inattendue (${response.status}).`,
      response.status,
      payload?.fields ?? {},
    );
  }
  return payload as T;
}

const segment = encodeURIComponent;

export const api = {
  me: () => request<{ email: string }>('/me'),

  content: () => request<{ values: Record<string, StoredValue> }>('/content'),

  saveContent: (pageId: string, values: Record<string, StoredValue>) =>
    request<PublishResult>(`/content/${segment(pageId)}`, {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }),

  entries: (collection: string) =>
    request<{ entries: Entry[] }>(`/entries/${segment(collection)}`),

  entry: (collection: string, id: string) =>
    request<{ entry: Entry }>(`/entries/${segment(collection)}/${segment(id)}`),

  createEntry: (collection: string, input: EntryInput) =>
    request<PublishResult & { id: string }>(`/entries/${segment(collection)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateEntry: (collection: string, id: string, input: EntryInput) =>
    request<PublishResult & { id: string }>(
      `/entries/${segment(collection)}/${segment(id)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),

  deleteEntry: (collection: string, id: string) =>
    request<PublishResult>(`/entries/${segment(collection)}/${segment(id)}`, {
      method: 'DELETE',
    }),

  uploadMedia: (form: FormData) =>
    request<MediaUpload>('/media', { method: 'POST', body: form }),

  publishStatus: () => request<PublishStatus>('/publish'),

  republish: () => request<PublishResult>('/publish', { method: 'POST' }),
};
