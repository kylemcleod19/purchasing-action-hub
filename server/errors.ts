import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found.`);
export const stale = () =>
  new HttpError(409, 'This record changed since you opened it. Reload to see the latest saved values, then try again.');

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'form';
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, 'Check the highlighted fields.', fields);
}
