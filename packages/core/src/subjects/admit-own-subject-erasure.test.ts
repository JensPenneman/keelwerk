import { expect, test } from 'vitest';
import type { Logger } from '../observability/logger.ts';
import type { Registry } from '../registry/registry.ts';
import { admitOwnSubjectErasure } from './admit-own-subject-erasure.ts';

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
    admitOwnSubjectErasure(source, scope, {
      commandId: 'c',
      entity: 'shop.order',
      subjectId: 's',
      reason: 'retention',
    }),
  ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
});
