import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';

function forbidden(message: string, draft: AnyDraft): KeelwerkError {
  return new KeelwerkError({
    kind: 'forbidden',
    code: 'core.forbidden',
    message,
    details: { entity: draft.entity, draft: draft.kind },
  });
}

/** A draft outside the module boundary is `forbidden`, never ignored (section 8.4). */
export function assertBoundary(entry: EntityEntry, draft: AnyDraft, authority: string): void {
  if (entry.module === authority) return;
  const fields = Object.keys(draft.values);
  const allContributed =
    fields.length > 0 && fields.every((name) => entry.origin[name] === authority);
  if (draft.kind === 'update' && allContributed) return;
  throw forbidden(
    `"${authority}" may not write ${entry.ref}: a module changes another module's entity only in the fields it contributed.`,
    draft,
  );
}
