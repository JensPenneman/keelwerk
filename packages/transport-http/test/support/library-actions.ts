import type { Invocation, Outcome } from '@keelwerk/core';

/** Handlers for the surface above. */
export const libraryActions: Readonly<
  Record<string, (invocation: Invocation<unknown>) => Outcome<unknown>>
> = {
  'library.echo': (invocation) => ({ ok: true, value: `echo:${JSON.stringify(invocation.input)}` }),
  'library.lookup': () => ({ ok: true, value: 'found' }),
  'library.stamp': () => ({ ok: true, value: Temporal.Instant.from('2030-01-02T03:04:05.678Z') }),
  'auth.login': () => ({
    ok: true,
    value: {
      sessionToken: 'secret-token',
      expiresAt: Temporal.Instant.from('2030-01-01T00:00:00Z'),
    },
  }),
};
