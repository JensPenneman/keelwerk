import { ns } from './ns.ts';

/** Inserts one serial row; `$1` is the scope id and `$2` the field. */
export const insertSerial = `insert into ${ns}.kw_serials values ($1, 'a.b', $2, '[]', 1)`;
