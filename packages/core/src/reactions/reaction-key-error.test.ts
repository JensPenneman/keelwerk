import { describe, expect, test } from 'vitest';
import { reactionOf, reactionRegistry } from '../../test/reaction-kit.ts';
import { reactionKeyError } from './reaction-key-error.ts';

const registry = reactionRegistry();
const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';

describe('the key a reaction declared for an event', () => {
  test('is unusable when it is not text or is empty', () => {
    const ordered = reactionOf(registry, 'ordered');
    for (const key of ['', undefined, null, 7]) {
      expect(reactionKeyError(ordered, key)).toBe('core.reaction_key_invalid');
    }
    expect(reactionKeyError(ordered, 'chan')).toBeUndefined();
  });

  test('of a process with personal members is the id of its data subject, a lower-case UUID', () => {
    const tally = reactionOf(registry, 'tally');
    expect(reactionKeyError(tally, subject)).toBeUndefined();
    for (const key of ['ada', subject.toUpperCase(), `${subject}x`]) {
      expect(reactionKeyError(tally, key)).toBe('core.process_instance_key_invalid');
    }
    expect(reactionKeyError(tally, '')).toBe('core.reaction_key_invalid');
  });

  test('of a process without personal members may be any text', () => {
    const plain = { ...reactionOf(registry, 'tally'), eventShapes: {} };
    expect(reactionKeyError(plain, 'ada')).toBeUndefined();
  });
});
