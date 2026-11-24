import type { ApiSurface } from '@keelwerk/core';
import { probeSurface } from '../../support/probe-surface.ts';

/** The probe surface with a subscription `shop.feed` and `core.effectStatusWatch`, and the live module when asked. */
export function surfaceWithWatch(withLive: boolean): ApiSurface {
  const base = probeSurface();
  const ping = base.actions.find((candidate) => candidate.ref === 'shop.ping');
  if (ping === undefined) throw new Error('The probe surface has no shop.ping.');
  const text = { optional: false, access: 'read-write', kind: 'string' } as const;
  return {
    ...base,
    ...(withLive && { modules: [...base.modules, { id: 'live', version: '1.0.0' }] }),
    actions: [
      ...base.actions,
      { ...ping, ref: 'shop.feed', name: 'feed', kind: 'subscription', output: text },
      {
        ...ping,
        ref: 'core.effectStatusWatch',
        module: 'core',
        name: 'effectStatusWatch',
        kind: 'subscription',
        input: {
          optional: false,
          access: 'read-write',
          kind: 'shape',
          fields: { ids: { optional: false, access: 'read-write', kind: 'list', item: text } },
        },
        output: text,
      },
    ],
  } as ApiSurface;
}
