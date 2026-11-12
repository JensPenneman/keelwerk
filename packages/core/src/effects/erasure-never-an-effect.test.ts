import { expect, test, vi } from 'vitest';
import { shape } from '../fields/shape.ts';
import type { EnqueueEffect } from '../protocol/enqueue-effect.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import type { SetTimerEffect } from '../protocol/set-timer-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EffectScene } from './effect-scene.ts';
import { runEnqueueEffect } from './run-enqueue-effect.ts';
import { runInvokeEffect } from './run-invoke-effect.ts';
import { runTimerEffects } from './run-timer-effects.ts';

const eraseSubject = {
  kind: 'command',
  ref: 'core.eraseSubject',
  module: 'core',
  scope: 'tenant',
  execution: 'async',
  input: shape({}),
} as unknown as ActionEntry;

function sceneOf() {
  const enqueue = vi.fn(async () => undefined);
  const scene = {
    unit: { jobs: { enqueue } },
    run: {
      registry: { actions: new Map([['core.eraseSubject', eraseSubject]]) },
      scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
      principal: { kind: 'user', subject: 'ada', via: 'auth.session' },
    },
    module: 'shop',
  } as unknown as EffectScene;
  return { scene, enqueue };
}

const refused = { code: 'core.request_not_allowed' };

test('an enqueue effect never names core.eraseSubject', async () => {
  const { scene, enqueue } = sceneOf();
  const effect = {
    kind: 'enqueue',
    action: 'core.eraseSubject',
    input: { subjectId: 'x', reason: 'operator' },
  } as unknown as EnqueueEffect;
  await expect(runEnqueueEffect(scene, effect, 'e1')).rejects.toMatchObject(refused);
  expect(enqueue).not.toHaveBeenCalled();
});

test('an invoke effect never names core.eraseSubject', async () => {
  const { scene, enqueue } = sceneOf();
  const effect = {
    kind: 'invoke',
    action: 'core.eraseSubject',
    input: { subjectId: 'x', reason: 'operator' },
  } as unknown as InvokeEffect;
  await expect(runInvokeEffect(scene, effect, 'e1')).rejects.toMatchObject(refused);
  expect(enqueue).not.toHaveBeenCalled();
});

test('a timer never names core.eraseSubject', async () => {
  const { scene, enqueue } = sceneOf();
  const effect = {
    kind: 'setTimer',
    key: 'erase-later',
    after: '1h',
    action: 'core.eraseSubject',
    input: { subjectId: 'x', reason: 'operator' },
  } as unknown as SetTimerEffect;
  await expect(runTimerEffects(scene, effect, 'e1')).rejects.toMatchObject(refused);
  expect(enqueue).not.toHaveBeenCalled();
});
