import { defineFill } from '../../../../../define-fill.ts';
import { within } from '../../../../../within.ts';
import { authBase } from '../../../base.ts';
import { toAccounts } from '../contribution.ts';

export const identityProviders = defineFill(
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
