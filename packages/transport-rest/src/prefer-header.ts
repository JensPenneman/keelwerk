/** What a `Prefer` header (RFC 7240) asks for. */
export interface Preference {
  readonly respondAsync: boolean;
  /** Seconds, at most 60; read but not honoured without the live module (section 16.4.7, S-62). */
  readonly wait?: number;
}

/** Parses `Prefer: respond-async, wait=10`; unknown preferences are ignored as RFC 7240 requires. */
export function preferHeader(value: string | null): Preference {
  let respondAsync = false;
  let wait: number | undefined;
  for (const part of (value ?? '').split(',')) {
    const [name, argument] = part.trim().split('=');
    const token = name?.trim().toLowerCase();
    if (token === 'respond-async') {
      respondAsync = true;
    } else if (token === 'wait') {
      const seconds = Number(argument?.trim());
      if (Number.isInteger(seconds) && seconds >= 0) {
        wait = Math.min(seconds, 60);
      }
    }
  }
  return { respondAsync, ...(wait !== undefined && { wait }) };
}
