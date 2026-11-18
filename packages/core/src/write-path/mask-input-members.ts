import type { AnyField } from '../fields/field-def.ts';
import { jsonShapeFields } from '../fields/json-shape-fields.ts';
import { personalFlagOf } from '../fields/personal-flag-of.ts';
import { holdsCredential } from '../keys/holds-credential.ts';
import { holdsPersonal } from '../registry/holds-personal.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { withheldMember } from './withheld-member.ts';

type MaskField = AnyField | FieldDescriptor;
type MaskFields = Readonly<Record<string, MaskField>>;

function isPersonal(field: MaskField): boolean {
  return 'flags' in field ? personalFlagOf(field) !== false : holdsPersonal(field);
}

function withheld(field: MaskField, mode: MaskMode): boolean {
  return holdsCredential(field) || (mode === 'credentials-and-personal' && isPersonal(field));
}

/** The member fields of a `json` field over a keelwerk shape; a descriptor has none. */
function jsonFields(field: MaskField): MaskFields | undefined {
  return 'flags' in field ? jsonShapeFields(field) : undefined;
}

/** A non-null, non-array object that is no set, byte array or Temporal value. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value) || value instanceof Set || value instanceof Uint8Array) return false;
  const tag: unknown = Reflect.get(value, Symbol.toStringTag);
  return !(typeof tag === 'string' && tag.startsWith('Temporal.'));
}

function maskMember(field: MaskField, value: unknown, mode: MaskMode): unknown {
  if (value === undefined || value === null) return value;
  if (withheld(field, mode)) return withheldMember;
  const { inner } = field;
  if (inner !== null && (Array.isArray(value) || value instanceof Set)) {
    return [...value].map((element) => maskMember(inner, element, mode));
  }
  const members = jsonFields(field);
  return members === undefined ? value : maskInputMembers(members, value, mode);
}

/**
 * What is withheld: `credentials` the value of every secret and verifier member (the receipt
 * fingerprint), `credentials-and-personal` also every personal member (the decision base).
 */
export type MaskMode = 'credentials' | 'credentials-and-personal';

/**
 * `value` with the value of every member of `fields` that `mode` withholds replaced by the marker
 * `kw:withheld`, so a digest of it holds no credential (and, in `credentials-and-personal`, no
 * personal value). A member counts only when it is present and not `null`: presence is not
 * withheld. A list or set is one marker when its element is withheld, else its elements are
 * walked (a set becomes a list, as `encodeEventValue` writes it); a `json` member over a keelwerk
 * shape is walked with that shape's fields; a member a field does not declare and any other value
 * pass unchanged. A personal member inside a `field.json()` value is neither sealed nor reliably
 * withheld: only the walk of an input shape reaches it, a descriptor (a generated record) has no
 * shape to walk, and no storage seals it. A value that is no plain object is answered as it is.
 * Pure: it never throws and never reads a value it withholds.
 */
export function maskInputMembers(fields: MaskFields, value: unknown, mode: MaskMode): unknown {
  if (!isPlainObject(value)) return value;
  const masked: Record<string, unknown> = { ...value };
  for (const [name, field] of Object.entries(fields)) {
    if (Object.hasOwn(masked, name)) masked[name] = maskMember(field, masked[name], mode);
  }
  return masked;
}
