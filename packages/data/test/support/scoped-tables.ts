import { member } from './member.ts';
import { note } from './note.ts';
import { team } from './team.ts';

export const scopedTables = [
  ...[team, member, note].map((entity) => ({
    schema: 'app',
    name: entity.table,
    column: 'tenant_id' as const,
  })),
  { schema: 'app', name: 'kw_positions', column: 'scope_id' as const },
];
