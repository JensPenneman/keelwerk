import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { issueResetToken } from '../lib/issue-reset-token.ts';

/**
 * The operator's way to a reset link without a delivery filler: inside an entered tenant it
 * returns the one-time token and its expiry for the operator to pass on (17.2.5, S-43).
 */
const issueResetLinkDef = defineCommand(authBase, {
  input: shape({ identifier: field.string({ format: 'email' }) }),
  output: shape({ token: field.string(), expiresAt: field.instant() }),
  shownOnce: ['token'],
  principal: 'operator',
  execution: 'sync',
  *decide(input, ctx) {
    const found = yield* ctx.load.auth.credential.one({
      where: { identifier: input.identifier, kind: 'password', revokedAt: { isNull: true } },
    });
    if (found === undefined) throw errors.not_found('No password credential has this identifier.');
    const issued = yield* issueResetToken(ctx, found);
    return { events: [issued.draft], result: { token: issued.token, expiresAt: issued.expiresAt } };
  },
});

type IssueResetLinkPart = typeof issueResetLinkDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface IssueResetLink extends IssueResetLinkPart {}
export const issueResetLink: IssueResetLink = issueResetLinkDef;
