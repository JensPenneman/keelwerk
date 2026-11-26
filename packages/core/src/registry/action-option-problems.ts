import type { AnyActionPart } from '../model/action-part.ts';
import type { PartMount } from './action-entry-of.ts';
import { specOf } from './action-spec-view.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/**
 * Options that fail open when they hold a value no one meant: an `auth` that is neither `'policy'`
 * nor `{ public: true }` would read as public, an `internal` that is neither absent nor `true`
 * would leave the command listed and reachable (an untyped or cast literal). They do not compose.
 */
export function actionOptionProblems(part: AnyActionPart, at: PartMount): CompositionProblem[] {
  const spec = specOf(part);
  const auth: unknown = spec.auth;
  const knownAuth =
    auth === undefined ||
    auth === 'policy' ||
    (typeof auth === 'object' && auth !== null && Reflect.get(auth, 'public') === true);
  const site = { module: at.module, ref: at.ref };
  return [
    ...(knownAuth
      ? []
      : [
          compositionError(
            'unknownAuth',
            `The action '${at.ref}' declares an auth that is neither 'policy' nor { public: true }.`,
            site,
          ),
        ]),
    ...(spec.internal === undefined || spec.internal === true
      ? []
      : [
          compositionError(
            'internalCommands',
            `The action '${at.ref}' declares an internal that is neither absent nor true.`,
            site,
          ),
        ]),
  ];
}
