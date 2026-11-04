import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

export const member: EntityDescriptor = entityOf(
  'app.member',
  'app__member',
  'tenant',
  {
    teamId: fieldOf('ref', 'team_id', { optional: false }),
    userId: fieldOf('subject', 'user_id', { optional: false }),
    role: fieldOf('enum', 'role'),
    seenAt: fieldOf('instant', 'seen_at'),
  },
  { team: { kind: 'one', target: 'app.team', by: 'id', to: 'teamId', contributedBy: null } },
);
