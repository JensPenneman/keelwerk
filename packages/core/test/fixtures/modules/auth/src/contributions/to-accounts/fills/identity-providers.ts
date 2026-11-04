import { defineFill, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { toAccounts } from '../contribution.ts';

export const identityProvidersFill = defineFill(
  within(authBase, toAccounts),
  'identityProviders',
  (own) => [
    {
      id: 'auth.password',
      label: 'Password',
      *listFor(profileId) {
        const rows = yield* own.load.auth.credential.many({ where: { kind: 'password' } });
        return rows.map((row) => `${profileId}:${row.kind}`);
      },
    },
  ],
);
