import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { AnyField } from './field-def.ts';

/** A mark a member can carry: personal data, a secret, a verifier (section 14.7.4). */
export type MarkKind = 'personal' | 'secret' | 'verifier';

/**
 * A place where a module declares a shape: the fields of an entity, the payload of a domain event,
 * an event of a process, the record of a stream, the input and the output of a command, the extra
 * input of a continuation, the input and the output of an effect, the configuration of a module.
 */
export type MarkSite =
  | 'entity'
  | 'domainEvent'
  | 'processEvent'
  | 'streamRecord'
  | 'commandInput'
  | 'commandOutput'
  | 'outcomeInput'
  | 'effectInput'
  | 'effectOutput'
  | 'configuration';

/**
 * Where in a shape a mark sits: `top` is the member itself, `element` the element of a list or set
 * (at any depth, a list of lists included), `nested` anything inside a `json` member over a shape.
 */
export type MarkPosition = 'top' | 'element' | 'nested';

/** A mark found in a member: its path from the member, its kind, its position and, if personal, its subject path. */
export interface Mark {
  readonly path: string;
  readonly kind: MarkKind;
  readonly position: MarkPosition;
  readonly subject: string | null;
}

/** A field of a declared shape or of an entity descriptor. */
export type MarkedField = AnyField | FieldDescriptor;

/**
 * What the kernel does with a mark at one position of one site: `true` it protects the value
 * (sealed wherever the kernel stores it or passes it on, never in clear in a copy it shows, and for
 * personal data reached by the erasure of its subject); `false` the composition check refuses it;
 * a text is the code of another check that refuses it there already (the error 0.2.0 raised), so
 * this one says nothing more.
 */
export type MarkCell = boolean | string;
