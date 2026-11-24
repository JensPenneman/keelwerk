import { expect, test, vi } from 'vitest';
import { eraseOwnSubject } from '../dsl/erase-own-subject.ts';
import type { EffectScene } from './effect-scene.ts';
import { runEraseOwnSubjectEffect } from './run-erase-own-subject-effect.ts';

const refused = { code: 'core.request_not_allowed' };

function sceneOf(scope: object, entity: object | undefined) {
  const enqueue = vi.fn(async () => undefined);
  const scene = {
    unit: { jobs: { enqueue } },
    run: {
      registry: { entities: new Map(entity === undefined ? [] : [['shop.order', entity]]) },
      scope,
    },
    module: 'shop',
  } as unknown as EffectScene;
  return { scene, enqueue };
}

const tenant = { level: 'tenant', backendId: 'b', tenantId: 't' };
const own = {
  module: 'shop',
  ref: 'shop.order',
  descriptor: { tenancy: 'tenant', dataSubject: 'id' },
};
const effect = eraseOwnSubject({ type: 'shop.order', id: '0192f3a0-0000-7000-8000-000000000001' });

test('C7: a subject is erased in a tenant: a backend or deployment unit refuses the request', async () => {
  for (const scope of [{ level: 'backend', backendId: 'b' }, { level: 'deployment' }]) {
    const { scene, enqueue } = sceneOf(scope, own);
    await expect(runEraseOwnSubjectEffect(scene, effect, 'e1')).rejects.toMatchObject(refused);
    expect(enqueue).not.toHaveBeenCalled();
  }
});

test('an entity of another module, an unknown one and one without a data subject are refused', async () => {
  const others = [
    undefined,
    { ...own, module: 'other' },
    { ...own, descriptor: { tenancy: 'tenant', dataSubject: null } },
    { ...own, descriptor: { tenancy: 'backend', dataSubject: 'id' } },
  ];
  for (const entity of others) {
    const { scene, enqueue } = sceneOf(tenant, entity);
    await expect(runEraseOwnSubjectEffect(scene, effect, 'e1')).rejects.toMatchObject(refused);
    expect(enqueue).not.toHaveBeenCalled();
  }
});
