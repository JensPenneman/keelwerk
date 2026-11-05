import { defineFill, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { subjectOfProfile } from '../../../lib/subject-of-profile.ts';
import { toAccounts } from '../contribution.ts';

const pageSize = 100;

/** The sign-in methods of a profile: its live credentials, read with auth's own authority (5.5). */
export const identityProvidersFill = defineFill(
  within(authBase, toAccounts),
  'identityProviders',
  (own) => [
    {
      id: 'auth.credentials',
      label: 'Sign-in methods',
      *listFor(profileId) {
        const rows = yield* own.load.auth.credential.many({
          where: { subject: subjectOfProfile(profileId), revokedAt: { isNull: true } },
          limit: pageSize,
        });
        return rows.map((row) => ({
          kind: row.kind,
          label: row.label ?? (row.kind === 'password' ? 'Password' : 'Passkey'),
          createdAt: row.createdAt,
        }));
      },
    },
  ],
);
