import { fakeAction, fakeSurface, instantNode, stringNode } from './fake-surface.ts';

const base = { optional: false, access: 'read-write' } as const;

const loginOutput = {
  ...base,
  kind: 'shape',
  fields: { sessionToken: stringNode, expiresAt: instantNode },
} as const;

/** The surface the protocol tests invoke against. */
export const librarySurface = fakeSurface(
  [
    fakeAction('library.echo', { output: stringNode, auth: 'public' }),
    fakeAction('library.lookup', { output: stringNode, kind: 'query' }),
    fakeAction('library.stamp', { output: instantNode, kind: 'query' }),
    fakeAction('auth.login', {
      output: loginOutput,
      hints: {
        http: {
          cookie: {
            set: {
              name: '__Host-keelwerk_session',
              from: 'sessionToken',
              expiresFrom: 'expiresAt',
            },
            omitFromBody: ['sessionToken'],
          },
        },
      },
    }),
  ],
  'sha256-library',
);
