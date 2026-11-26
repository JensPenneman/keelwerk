import { ns } from './ns.ts';

/** One `core__command_receipt` row whose scope and id are `$1`: the least a pending receipt stores. */
export const receiptSeed = `insert into ${ns}.core__command_receipt (scope_id, id, version, command_id, action, fingerprint, status, api_version, transport, expires_at)
  values ($1, $1, 1, 'c1', 'app.note.set', 'f1', 'pending', '2026-01-01', 'rest', now() + interval '1 day')`;
