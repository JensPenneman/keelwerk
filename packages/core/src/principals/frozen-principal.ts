import type { AnsweredPrincipal } from './answered-principal.ts';
import { madePrincipals } from './made-principals.ts';
import type { Principal } from './principal.ts';
import { readList } from './read-list.ts';
import { refusePrincipal as refuse } from './refuse-principal.ts';

/**
 * Plain data, built anew and frozen: objects with the Object prototype (or none), arrays, strings,
 * numbers, booleans, null and undefined, and nothing else. An array's length is read once and each
 * index once, an object's own enumerable members once each, and no method of an answered value is
 * called: the result holds no object the answer handed over, and what is checked is the copy.
 */
function plain(value: unknown, path: string): unknown {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) {
    return value;
  }
  if (typeof value !== 'object') return refuse(path);
  if (Array.isArray(value)) {
    const members = readList(value, path);
    return Object.freeze(members.map((member, index) => plain(member, `${path}[${index}]`)));
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return refuse(path);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, plain(member, `${path}.${key}`)]),
    ),
  );
}

/** The expiry, the one Temporal value a principal's types declare: read once as text, built anew. */
function expiryOf(value: unknown): Temporal.Instant {
  try {
    return Temporal.Instant.from(Temporal.Instant.prototype.toString.call(value));
  } catch {
    return refuse('expiresAt');
  }
}

type Plain = Readonly<Record<string, unknown>>;

const isString = (value: unknown): boolean => typeof value === 'string';

/** Whether `value` is an object whose members are all of the stated kind. */
function shaped(value: unknown, members: Readonly<Record<string, (v: unknown) => boolean>>) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.entries(members).every(([name, ok]) => ok((value as Plain)[name]))
  );
}

/** The fields that say who the caller is are of their declared primitive types. */
function declared(copy: Plain): void {
  const nullable = (value: unknown) => value === null || isString(value);
  const checks: readonly [string, boolean][] = [
    ['kind', isString(copy.kind)],
    ['via', isString(copy.via)],
    ['scope', shaped(copy.scope, { backend: nullable, tenant: nullable })],
    [
      'ref',
      copy.ref === null ||
        copy.ref === undefined ||
        shaped(copy.ref, { resolver: isString, principalId: isString }),
    ],
    ['roles', Array.isArray(copy.roles) && copy.roles.every(isString)],
    // The members of each membership are checked where its kind is, by `keepOwnMemberships`.
    ['memberships', Array.isArray(copy.memberships)],
    ['subject', copy.kind !== 'user' || (isString(copy.subject) && nullable(copy.subjectRef))],
    ['id', (copy.kind !== 'service' && copy.kind !== 'operator') || isString(copy.id)],
    ['idRef', copy.kind !== 'service' || copy.idRef === undefined || nullable(copy.idRef)],
    ['reason', copy.kind !== 'system' || isString(copy.reason)],
    ['apiVersion', copy.apiVersion === undefined || isString(copy.apiVersion)],
  ];
  for (const [path, ok] of checks) if (!ok) refuse(path);
}

/**
 * Every principal the kernel makes, and every principal a fill answers, goes through here when it is
 * made, and the kernel never writes into one afterwards: a later stage makes a new one. A principal
 * contains only objects the kernel built itself, from values read once: what a fill answers is plain
 * data or it is refused, a Temporal value is taken only as the expiry, and the fields that say who
 * the caller is are of their declared types. The two functions of a user and a service are built here
 * from the subject, its reference and the id; an answer that carries a function is refused.
 */
export function frozenPrincipal<P extends Principal = Principal>(
  principal: AnsweredPrincipal<P>,
): P {
  const prototype = Object.getPrototypeOf(principal) as unknown;
  if (prototype !== Object.prototype && prototype !== null) refuse('principal');
  const copy: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(principal)) {
    copy[key] = key === 'expiresAt' && member !== undefined ? expiryOf(member) : plain(member, key);
  }
  declared(copy);
  const { kind, subject, subjectRef } = copy;
  if (kind === 'user') {
    copy.subjectAs = (ref: string) => (subjectRef !== null && ref === subjectRef ? subject : null);
  }
  if (kind === 'service') {
    const { id, idRef } = copy;
    copy.idAs = (ref: string) =>
      idRef !== undefined && idRef !== null && ref === idRef ? id : null;
  }
  const made = Object.freeze(copy) as unknown as P;
  madePrincipals.add(made);
  return made;
}
