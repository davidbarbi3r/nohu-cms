export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...init.headers,
    },
  });

/** Erreur lisible par l'admin : `{ error: "message en français", fields? }`. */
export const fail = (
  status: number,
  error: string,
  fields?: Record<string, string>,
) => json({ error, fields }, { status });

/** Formulaire refusé : un message par champ à corriger. */
export const invalid = (fields: Record<string, string | undefined>) =>
  fail(
    422,
    'Certains champs sont à corriger.',
    Object.fromEntries(
      Object.entries(fields).filter((entry): entry is [string, string] =>
        Boolean(entry[1]),
      ),
    ),
  );

export async function readJson<T>(request: Request): Promise<T | null> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return null;
  }
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const now = () => new Date().toISOString();
