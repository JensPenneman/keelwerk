import {
  type ApiSurface,
  hasProjectableInput,
  type SurfaceAction,
  type TransportProblem,
} from '@keelwerk/core';
import { isTrpcExposed } from '../router/is-trpc-exposed.ts';
import { trpcPathOf } from '../router/trpc-path-of.ts';
import { trpcProblem } from './trpc-problem.ts';

/** The words tRPC refuses as a router key at any level. */
const reservedWords: ReadonlySet<string> = new Set(['then', 'call', 'apply']);

function order(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function unsupportedShapes(action: SurfaceAction): TransportProblem[] {
  const problems: TransportProblem[] = [];
  if (!hasProjectableInput(action)) {
    problems.push(
      trpcProblem(
        'unsupportedShape',
        action.ref,
        `The input is a ${action.input.kind}; tRPC takes a shape, a foreign schema or no input. Declare the input as a shape, or hide the action with hints.trpc.expose: false.`,
      ),
    );
  }
  if (action.hints.trpc?.path !== undefined) {
    problems.push(
      trpcProblem(
        'unsupportedShape',
        action.ref,
        'The router type follows the action tree and cannot follow a renamed path; remove hints.trpc.path.',
      ),
    );
  }
  return problems;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether the input of a subscription has a member named `lastEventId`. tRPC merges the
 * Last-Event-ID header and the lastEventId query parameter into the input of a subscription under
 * this key, and the router strips it as the resume token.
 */
function namesResumeKey(action: SurfaceAction): boolean {
  const { input } = action;
  if (input.kind === 'shape') return Object.hasOwn(input.fields, 'lastEventId');
  if (input.kind !== 'foreign') return false;
  const { properties } = input.input;
  return isRecord(properties) && Object.hasOwn(properties, 'lastEventId');
}

/**
 * A resumable subscription whose foreign input is no object: tRPC's client adds the resume token
 * only to an object input, and the server merges it into an object or an absent input only, so
 * every reconnect would start from now and lose what was written meanwhile.
 */
function resumeNeedsObject(action: SurfaceAction): TransportProblem[] {
  const { input } = action;
  if (action.kind !== 'subscription' || !action.resumable || input.kind !== 'foreign') return [];
  if (input.input.type === 'object') return [];
  return [
    trpcProblem(
      'unsupportedShape',
      action.ref,
      'The input is a foreign schema that is no object, and tRPC resumes a subscription through a member of an object input; declare the input as an object, or hide the action with hints.trpc.expose: false.',
    ),
  ];
}

/**
 * The `__Host-` prefix of 16.4.10 on the cookie hint: tRPC applies the hint as given, so a name
 * without the prefix must never start.
 */
function cookieNames(action: SurfaceAction): TransportProblem[] {
  const cookie = action.hints.http?.cookie;
  return [cookie?.set?.name, cookie?.clear?.name].flatMap((name) =>
    name === undefined || name.startsWith('__Host-')
      ? []
      : [
          trpcProblem(
            'cookieName',
            action.ref,
            `The cookie '${name}' must carry the '__Host-' prefix (section 16.4.10).`,
          ),
        ],
  );
}

function reservedNames(action: SurfaceAction, path: readonly string[]): TransportProblem[] {
  const problems = path
    .filter((segment) => reservedWords.has(segment))
    .map((segment) =>
      trpcProblem(
        'reservedName',
        action.ref,
        `The path segment '${segment}' is a word tRPC reserves ('then', 'call', 'apply'); rename the action, the entity or the module, or hide the action with hints.trpc.expose: false.`,
      ),
    );
  if (action.kind === 'subscription' && namesResumeKey(action)) {
    problems.push(
      trpcProblem(
        'reservedName',
        action.ref,
        "The input member 'lastEventId' is the resume key tRPC fills from Last-Event-ID in a subscription; rename the member, or hide the action with hints.trpc.expose: false.",
      ),
    );
  }
  return problems;
}

/** Two actions with one path, or a path that is a prefix of another's: a procedure cannot also be a router. */
function collisions(
  placed: readonly { readonly action: SurfaceAction; readonly path: readonly string[] }[],
): TransportProblem[] {
  const problems: TransportProblem[] = [];
  for (const [index, left] of placed.entries()) {
    for (const right of placed.slice(index + 1)) {
      const shorter = left.path.length <= right.path.length ? left : right;
      const longer = shorter === left ? right : left;
      if (shorter.path.every((segment, at) => segment === longer.path[at])) {
        const same = shorter.path.length === longer.path.length;
        problems.push(
          trpcProblem(
            'nameCollision',
            left.action.ref,
            same
              ? `${left.action.ref} and ${right.action.ref} both have the path ${left.path.join('.')}; rename one or hide it with hints.trpc.expose: false.`
              : `The path ${shorter.path.join('.')} of ${shorter.action.ref} is the start of the path ${longer.path.join('.')} of ${longer.action.ref}; rename one or hide it with hints.trpc.expose: false.`,
          ),
        );
      }
    }
  }
  return problems;
}

/**
 * What the router cannot carry (sections 16.3.2, 16.4.10 and 16.7, S-153), as named problems over
 * the exposed actions: an input that is no shape, a `hints.trpc.path`, a reserved word in a path, a
 * subscription input member named `lastEventId` (also in a foreign schema), a resumable
 * subscription whose foreign input is no object, a cookie hint name without the `__Host-` prefix
 * (`cookieName`) and paths that collide. Pure and stably ordered by code, subject and message;
 * `mount` refuses the first of them.
 */
export function checkTrpcSurface(surface: ApiSurface): readonly TransportProblem[] {
  const exposed = surface.actions.filter(isTrpcExposed);
  const placed = exposed.map((action) => ({ action, path: trpcPathOf(action) }));
  const problems = [
    ...exposed.flatMap(unsupportedShapes),
    ...exposed.flatMap(resumeNeedsObject),
    ...exposed.flatMap(cookieNames),
    ...placed.flatMap(({ action, path }) => reservedNames(action, path)),
    ...collisions(placed),
  ];
  const unique = new Map(
    problems.map((problem) => [
      JSON.stringify([problem.code, problem.subject, problem.message]),
      problem,
    ]),
  );
  return [...unique.values()].sort(
    (a, b) => order(a.code, b.code) || order(a.subject, b.subject) || order(a.message, b.message),
  );
}
