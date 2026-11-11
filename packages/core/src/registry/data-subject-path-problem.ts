import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldKind } from '../storage/field-kind.ts';
import { entityPathHead } from './entity-path-head.ts';
import type { PathHead } from './path-head.ts';

const idKinds: ReadonlySet<FieldKind> = new Set<FieldKind>(['subject', 'ref', 'string']);

/**
 * Why a dotted data-subject path (14.7.4, S-127) cannot name a subject, or undefined when it can:
 * every segment must be a field the row holds; none may be personal or sealed (a secret or a
 * verifier); every segment but the last must be a reference to an entity `describe` knows, and the
 * last must hold an id (a subject, a reference or a string). The answer completes the sentence
 * "names the data subject '<path>', ...".
 */
export function dataSubjectPathProblem(
  describe: (entity: string) => EntityDescriptor | undefined,
  head: PathHead,
  path: string,
): string | undefined {
  const segments = path.split('.');
  let current = head;
  for (const [index, segment] of segments.entries()) {
    const first = index === 0;
    const what = first ? 'first segment' : `segment '${segment}' of ${current.label}`;
    const field = current.field(segment);
    if (field === undefined) {
      return first
        ? `whose first segment is not a field of ${current.label}.`
        : `whose segment '${segment}' is not a field of ${current.label}.`;
    }
    if (field.personal) return `whose ${what} is a personal field.`;
    if (field.sealed) return `whose ${what} is a sealed field, which holds no subject id.`;
    if (index === segments.length - 1) {
      return idKinds.has(field.kind)
        ? undefined
        : `whose ${what} is of kind ${field.kind}, which holds no subject id.`;
    }
    const target = field.target === null ? undefined : describe(field.target);
    if (field.target === null) {
      return `whose ${what} is not a reference, so the path cannot continue.`;
    }
    if (target === undefined) {
      return `whose ${what} points at ${field.target}, which the app does not declare.`;
    }
    current = entityPathHead(target);
  }
  return undefined;
}
