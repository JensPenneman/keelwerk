import { defineQuery, field, shape } from '@keelwerk/core';
import { accountsBase } from '../base.ts';
import type { IdentitySummary } from '../extension-points/identity-providers.ts';

export const identities = defineQuery(accountsBase, {
  input: shape({ profileId: field.ref.own('profile') }),
  output: shape({
    providers: field.list(
      field.json(
        shape({
          id: field.string(),
          label: field.string(),
          items: field.list(
            field.json(
              shape({ kind: field.string(), label: field.string(), createdAt: field.instant() }),
            ),
          ),
        }),
      ),
    ),
  }),
  principal: 'user',
  *read(input, ctx) {
    const providers: {
      id: string;
      label: string;
      items: readonly IdentitySummary[];
    }[] = [];
    for (const provider of ctx.extensions.identityProviders) {
      providers.push({
        id: provider.id,
        label: provider.label,
        items: yield* provider.listFor(input.profileId),
      });
    }
    return { providers };
  },
});
