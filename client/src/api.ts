import type { ApiError } from '../../shared/types';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiRequestError(0, 'Could not reach the server. Check your connection and try again.');
  }
  const data = (await response.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!response.ok) {
    throw new ApiRequestError(response.status, data?.error ?? `Request failed (${response.status}).`, data?.fields ?? {});
  }
  return data as T;
}
