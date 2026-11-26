import { expect, test } from 'vitest';
import type { Logger } from '../observability/logger.ts';
import type { Registry } from '../registry/registry.ts';
import { admitErasure } from './admit-erasure.ts';

test('a request that names no entity is refused for good, not delayed', async () => {
  const log = { warn: () => undefined } as unknown as Logger;
  const source = {
    registry: { entities: new Map() } as unknown as Registry,
    namespace: {} as never,
    adapter: {} as never,
    providers: [],
    log,
  };
  const scope = { level: 'tenant', backendId: 'b', tenantId: 't' } as const;
  await expect(
    admitErasure(source, scope, {
      commandId: 'c',
      requester: {} as never,
      entity: 'shop.order',
      subjectId: 's',
      reason: 'retention',
    }),
  ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
});
