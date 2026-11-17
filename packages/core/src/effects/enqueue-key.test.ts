import { describe, expect, it } from 'vitest';
import { enqueueKey } from './enqueue-key.ts';
import { timerKey } from './timer-key.ts';

describe('enqueueKey', () => {
  it('the stored key is the module id, a colon and the key as the module wrote it', () => {
    expect(enqueueKey('echo', 'later')).toBe('echo:later');
    expect(enqueueKey('auth', 'auth.extend:s1')).toBe('auth:auth.extend:s1');
  });

  it('the same key in two modules gives two stored keys', () => {
    expect(enqueueKey('ticker', 'later')).not.toBe(enqueueKey('echo', 'later'));
  });

  it('it follows the rule of timerKey', () => {
    for (const [module, key] of [
      ['echo', 'later'],
      ['api-keys', 'a:b'],
      ['auth', ''],
    ] as const) {
      expect(enqueueKey(module, key)).toBe(timerKey(module, key));
    }
  });
});
