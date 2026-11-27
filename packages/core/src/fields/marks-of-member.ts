import { jsonShapeFields } from './json-shape-fields.ts';
import type { Mark, MarkedField, MarkKind, MarkPosition } from './mark-types.ts';
import type { ShapeFields } from './shape.ts';

/** The personal flag of a field or of a descriptor; anything that is not a flag object is no flag. */
function personalOf(field: MarkedField): { readonly subject: string | null } | undefined {
  const flag: unknown = 'flags' in field ? field.flags.personal : field.personal;
  return typeof flag === 'object' && flag !== null
    ? (flag as { readonly subject: string | null })
    : undefined;
}

/** `secret` or `verifier` for a field of that kind, and for a descriptor flagged sealed. */
function credentialOf(field: MarkedField): MarkKind | undefined {
  if (field.kind === 'secret' || field.kind === 'verifier') return field.kind;
  return 'sealed' in field && field.sealed ? 'secret' : undefined;
}

/** `inside` holds the json shapes being walked, so a shape that refers to itself ends the walk. */
function collect(
  field: MarkedField,
  path: string,
  position: MarkPosition,
  inside: ReadonlySet<ShapeFields>,
  marks: Mark[],
): void {
  const credential = credentialOf(field);
  if (credential !== undefined) marks.push({ path, kind: credential, position, subject: null });
  const personal = personalOf(field);
  if (personal !== undefined) {
    marks.push({ path, kind: 'personal', position, subject: personal.subject });
  }
  if (field.inner !== null) {
    collect(field.inner, `${path}[]`, position === 'top' ? 'element' : position, inside, marks);
  }
  const members = 'flags' in field ? jsonShapeFields(field) : undefined;
  if (members === undefined || inside.has(members)) return;
  const deeper = new Set(inside).add(members);
  for (const [name, member] of Object.entries(members)) {
    collect(member, `${path}.${name}`, 'nested', deeper, marks);
  }
}

/** Every mark of one member and of what it holds, at every position: the one walk, no mark stops it. */
export function marksOfMember(field: MarkedField, name = ''): readonly Mark[] {
  const marks: Mark[] = [];
  collect(field, name, 'top', new Set(), marks);
  return marks;
}
