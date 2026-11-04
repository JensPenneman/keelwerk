import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

export const team: EntityDescriptor = entityOf(
  'app.team',
  'app__team',
  'tenant',
  {
    name: fieldOf('string', 'name', { optional: false }),
    ownerId: fieldOf('subject', 'owner_id'),
  },
  { members: { kind: 'many', target: 'app.member', by: 'teamId', to: 'id', contributedBy: null } },
);
