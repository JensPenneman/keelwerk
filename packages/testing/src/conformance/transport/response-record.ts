/** A parsed JSON object, or undefined for anything else. */
export function responseRecord(body: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Readonly<Record<string, unknown>>)
    : undefined;
}
