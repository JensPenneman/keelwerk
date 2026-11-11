import { defineModuleBase, type ModuleBaseType, quota } from '@keelwerk/core';
import { task } from './entities/task.ts';
import { beta } from './flags/beta.ts';
import { layout } from './flags/layout.ts';
import { limit } from './flags/limit.ts';
import { log } from './streams/log.ts';

const m2PartsBaseDef = defineModuleBase({
  id: 'm2-parts',
  version: '1.2.0',
  entities: { task },
  streams: { log },
  flags: { beta, layout, limit },
  quotas: {
    storageBytes: quota.bytes().default('1GiB'),
    calls: quota.rate().default('100/1m', { level: 'backend' }),
  },
  observes: 'all',
  configAccess: { level: 'tenant', edit: 'policy' },
  gate: 'beta',
});

export interface M2PartsBase extends ModuleBaseType<typeof m2PartsBaseDef> {}
export const m2PartsBase: M2PartsBase = m2PartsBaseDef;
