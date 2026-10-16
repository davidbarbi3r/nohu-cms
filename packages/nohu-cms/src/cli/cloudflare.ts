/** Client minimal de l'API Cloudflare (v4), avec un jeton API. */

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
}

export type CloudflareApi = ReturnType<typeof cloudflareApi>;

export function cloudflareApi(token: string, fetcher: typeof fetch = fetch) {
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const payload = (await response
      .json()
      .catch(() => null)) as Envelope<T> | null;
    if (!response.ok || !payload?.success) {
      const error = payload?.errors?.[0];
      throw new CloudflareError(
        `${method} ${path.split('?')[0]} (${response.status}) : ${error?.message ?? 'réponse invalide'}`,
        response.status,
        error?.code ?? null,
      );
    }
    return payload.result as T;
  }
  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  };
}
