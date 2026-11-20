import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { entry } from './entities/entry.ts';

const auditBaseDef = defineModuleBase({
  id: 'audit',
  version: '0.1.0',
  observes: 'all',
  entities: { entry },
});

export interface AuditBase extends ModuleBaseType<typeof auditBaseDef> {}
export const auditBase: AuditBase = auditBaseDef;
