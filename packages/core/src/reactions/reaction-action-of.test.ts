import { describe, expect, test } from 'vitest';
import { reactionOf, reactionRegistry } from '../../test/reaction-kit.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { reactionActionOf } from './reaction-action-of.ts';

const reaction = reactionOf(reactionRegistry(), 'plain');
const errorSpecs = { 'logs.full': { kind: 'conflict', message: 'Full.' } } as const;

describe('the action a reaction decides as', () => {
  test('an inline reaction declares the errors of its command, with their specs', () => {
    const command = { scope: 'tenant', since: '0.1.0', errors: ['logs.full'], errorSpecs } as Pick<
      ActionEntry,
      'scope' | 'since' | 'errors' | 'errorSpecs'
    >;
    const action = reactionActionOf(reaction, command);
    expect(action.errors).toEqual(['logs.full']);
    expect(action.errorSpecs).toEqual(errorSpecs);
  });

  test('the job of an async reaction declares none', () => {
    const action = reactionActionOf(reaction, { scope: 'tenant', since: '0.1.0' });
    expect(action.errors).toEqual([]);
    expect(action).not.toHaveProperty('errorSpecs');
  });
});
