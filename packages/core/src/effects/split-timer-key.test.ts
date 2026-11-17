import { describe, expect, it } from 'vitest';
import { deadlineTimerKey } from './deadline-timer-key.ts';
import { splitTimerKey } from './split-timer-key.ts';
import { timerKey } from './timer-key.ts';

const by = (module: string) => ({ kind: 'action', principalId: `${module}.system` }) as const;

describe('splitTimerKey', () => {
  it('a stored key splits at its first colon, so the key may hold colons', () => {
    expect(splitTimerKey('ticker:a:b', by('ticker'))).toEqual({ module: 'ticker', key: 'a:b' });
    expect(
      splitTimerKey(deadlineTimerKey('x'), { kind: 'effect', principalId: 'orders.system' }),
    ).toEqual({ module: 'core.deadline', key: 'x' });
  });

  it('a kernel row with any other key is no deadline timer', () => {
    const job = { kind: 'effect', principalId: 'orders.system' } as const;
    expect(splitTimerKey('core:deadline:x', job)).toBeUndefined();
    expect(splitTimerKey('ticker:x', job)).toBeUndefined();
  });

  it('splitTimerKey gives back what timerKey joined', () => {
    for (const [module, key] of [
      ['ticker', 'pulse'],
      ['api-keys', 'api-keys.lastUse:k1'],
      ['echo', ''],
      ['echo', ':lead'],
    ] as const) {
      expect(splitTimerKey(timerKey(module, key), by(module))).toEqual({ module, key });
    }
  });

  it('a text with no colon or nothing before it is no timer key', () => {
    expect(splitTimerKey('pulse', by('pulse'))).toBeUndefined();
    expect(splitTimerKey(':pulse', by(''))).toBeUndefined();
    expect(splitTimerKey('', by(''))).toBeUndefined();
  });

  it('a 0.1.0 key with a colon is not shown as a timer of the module before it', () => {
    expect(splitTimerKey('invoice:42', by('billing'))).toBeUndefined();
    expect(splitTimerKey('core.deadline:x', by('billing'))).toBeUndefined();
    expect(
      splitTimerKey('invoice:42', { kind: 'effect', principalId: 'billing.system' }),
    ).toBeUndefined();
  });
});
