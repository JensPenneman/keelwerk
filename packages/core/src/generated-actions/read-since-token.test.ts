import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { user } from '../../test/invoker/invoker-kit.ts';
import { defineApp } from '../dsl/define-app.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import type { GeneratedReadInput } from './generated-read-input.ts';
import { readSinceToken } from './read-since-token.ts';

const { registry } = defineApp({ id: 'portal', modules: [accounts, auth] });
const entry = registry.entities.get('accounts.profile');
const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;

describe('readSinceToken', () => {
  const principal = user('ada');
  const tokens = { registry, rules: [], principal, epoch: 0, sealKey: new Uint8Array(32).fill(7) };
  const input = { entry, scope, tokens, head: 100n } as unknown as GeneratedReadInput;

  test('a token whose position was altered resets like a forged one, for the changes of an entity', () => {
    const token = issueStateToken(tokens, 'accounts.profile', scope, 50n);
    expect(readSinceToken(input, token, {})).toEqual({ ok: true, position: 50n });
    // The position moves back to 7: the check covers the position, so this is not a token the caller was given.
    const altered = token.replace('.50.', '.7.');
    expect(readSinceToken(input, altered, {})).toEqual({ ok: false, reason: 'check' });
    const forged = token.replace(/\.[0-9a-f]{32}$/, `.deadbeef${'0'.repeat(24)}`);
    expect(readSinceToken(input, forged, {})).toEqual({ ok: false, reason: 'check' });
  });
});
