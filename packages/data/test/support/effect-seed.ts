import { ns } from './ns.ts';

/** One `core__effect` row whose scope and id are `$1`: the least a requested effect stores. */
export const effectSeed = `insert into ${ns}.core__effect (scope_id, id, type, command_id, status, attempts, performer, event_ids)
  values ($1, $1, 'hooks.post', 'c1', 'requested', 0, 'executor', '[]')`;
