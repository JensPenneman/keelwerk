import { describe, expect, it } from 'vitest';
import { timerKey } from './timer-key.ts';

describe('timerKey', () => {
  it('the stored key is the module id, a colon and the key as the module wrote it', () => {
    expect(timerKey('ticker', 'pulse')).toBe('ticker:pulse');
    expect(timerKey('api-keys', 'api-keys.lastUse:k1')).toBe('api-keys:api-keys.lastUse:k1');
  });

  it("the kernel's deadline key keeps its text", () => {
    expect(timerKey('core', 'deadline:eff_1')).toBe('core:deadline:eff_1');
  });

  it('the same key text in two modules gives two stored keys', () => {
    expect(timerKey('ticker', 'pulse')).not.toBe(timerKey('echo', 'pulse'));
  });
});
