import { describe, expect, test } from 'vitest';
import { reactionRegistry, reactionTenantScope } from '../../test/reaction-kit.ts';
import { reactionJobAction } from './reaction-job-action.ts';

const registry = reactionRegistry();

describe('the command a reaction job decides as', () => {
  test('is the reaction as a module command of the job scope, taking the event reference', () => {
    const action = reactionJobAction(registry, 'logs.plain', reactionTenantScope, '2026-01-01');
    expect(action).toMatchObject({
      ref: 'logs.plain',
      module: 'logs',
      name: 'plain',
      kind: 'command',
      scope: 'tenant',
      since: '2026-01-01',
      errors: [],
    });
    const valid = { event: 'e', streamType: 'logs.note', streamId: 's', version: 1, position: '7' };
    expect(action.input['~standard'].validate(valid)).toEqual({ value: valid });
    expect(action.input['~standard'].validate({ event: 'e' })).toHaveProperty('issues');
    const failed = { ...valid, keyError: 'core.reaction_key_invalid' };
    expect(action.input['~standard'].validate(failed)).toEqual({ value: failed });
  });

  test('is not_implemented for an inline reaction, a missing one and an action', () => {
    for (const ref of ['logs.inline', 'logs.missing', 'core.me']) {
      expect(() => reactionJobAction(registry, ref, reactionTenantScope, '2026-01-01')).toThrow(
        expect.objectContaining({ kind: 'not_implemented', code: 'core.not_implemented' }),
      );
    }
  });
});
