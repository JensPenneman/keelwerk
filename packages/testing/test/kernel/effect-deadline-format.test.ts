import { deriveEffectId } from '@keelwerk/core';
import { describe, test } from 'vitest';
import {
  command,
  effectsKit,
  externalEffect,
  registryWith,
  stored,
} from './support/effects-kit.ts';
import { matchGolden } from './support/match-golden.ts';
import { plainJsonValue } from './support/plain-json-value.ts';
import { clock, tenant } from './support/run-read-kit.ts';

describe('the stored deadline of an effect with an outside performer', () => {
  test('the deadline job of an effect with an outside performer', async () => {
    const declared = externalEffect(
      'ship',
      async () => ({ ok: true }),
      {},
      { performer: 'external', executor: null },
    );
    const registry = registryWith({
      effects: [declared.effect],
      actions: [
        command('send', () => ({
          effects: [
            {
              kind: 'external',
              type: 'library.ship',
              input: { to: 'ada@example.org' },
              deadline: clock.now(),
            },
          ],
        })),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.send', {}, { commandId: 'c1' });
    const effectId = deriveEffectId(tenant, 'c1', 0);
    const ids = new Map([
      [effectId, '<derived effect id>'],
      [`core.deadline:${effectId}`, 'core.deadline:<derived effect id>'],
    ]);
    matchGolden(
      'deadline-timer-job',
      plainJsonValue((await stored(adapter, ['timers'])).jobs[0], ids),
    );
  });
});
