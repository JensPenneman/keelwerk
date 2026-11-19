import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { ownedRows } from './owned-rows.ts';

/**
 * The admission of `eraseOwnSubject` (section 14.7.5), run in the unit that ends the row: the id of
 * `row` (already in its canonical form) may be erased as a subject only when nothing but that row
 * holds it. The row must be live in this tenant; the subject's references, if any, must all name
 * that same stream; and no live row of any module may have the id as its data subject except that
 * row. A subject that is also another row's, or that another stream refers to, is refused, so a row
 * created with a copied id cannot be used to erase someone else. The message never repeats the id.
 */
export async function checkOwnSubjectErasure(
  unit: Unit,
  registry: Registry,
  row: StreamRef,
): Promise<void> {
  const refusal = (): KeelwerkError =>
    refuseRequest(
      `eraseOwnSubject of "${row.type}"`,
      'the subject is held by something other than this row',
    );
  const entry = registry.entities.get(row.type);
  if (entry === undefined) throw refusal();
  const found = await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: row.id },
    includeArchived: true,
    includeErased: false,
  });
  if (found === undefined) throw refusal();
  const references = await unit.keys.refs(row.id, null, 2);
  if (references.some((ref) => ref.type !== row.type || ref.id !== row.id)) throw refusal();
  const owned = await ownedRows(unit, {
    registry,
    subjectId: row.id,
    includeErased: false,
    after: null,
    limit: 2,
  });
  if (owned.rows.some((own) => own.type !== row.type || own.id !== row.id)) throw refusal();
}
