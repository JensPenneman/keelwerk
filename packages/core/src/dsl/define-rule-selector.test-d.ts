import { describe, test } from 'vitest';
import { authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import { defineRule } from './define-rule.ts';

describe('a rule over a selector (section 8.1)', () => {
  test('a selector target takes the action rule spec, deny only', () => {
    defineRule(
      authBase,
      { kinds: ['command'] },
      { effect: 'deny', reason: 'Read only.', principal: 'user', when: () => true },
    );
    defineRule(
      authBase,
      { transports: ['imap', 'smtp-submission'] },
      { effect: 'deny', reason: 'x' },
    );
    defineRule(
      authBase,
      { kinds: ['command', 'subscription'], transports: ['cli'] },
      { effect: 'deny', reason: 'x' },
    );
    // @ts-expect-error an allow over a selector would grant the actions of every module
    defineRule(authBase, { kinds: ['command'] }, { effect: 'allow' });
  });

  test('a selector naming neither kinds nor transports is refused', () => {
    // @ts-expect-error a selector names at least one of the two
    defineRule(authBase, {}, { effect: 'deny', reason: 'x' });
  });

  test('an unknown kind is refused', () => {
    // @ts-expect-error 'mutation' is no action kind
    defineRule(authBase, { kinds: ['mutation'] }, { effect: 'deny', reason: 'x' });
  });
});
