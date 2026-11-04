import type { EntityDescriptor } from '@keelwerk/core';
import { global } from './global.ts';
import { member } from './member.ts';
import { note } from './note.ts';
import { team } from './team.ts';

export const entities: ReadonlyMap<string, EntityDescriptor> = new Map(
  [team, member, note, global].map((entity) => [entity.ref, entity]),
);
