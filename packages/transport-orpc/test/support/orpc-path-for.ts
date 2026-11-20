import { deriveSurface } from '@keelwerk/core';
import { orpcPathOf } from '../../src/router/orpc-path-of.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './orpc-conformance-app.ts';

const surface = deriveSurface(orpcConformanceApp as never, orpcConformanceVersions.head).surface;

/** The path of an action of the conformance app below the mount, `library/findByIsbn`, as its reference names it. */
export function orpcPathFor(ref: string): string {
  const action = surface.actions.find((candidate) => candidate.ref === ref);
  if (action === undefined) throw new Error(`The suite has no action '${ref}'.`);
  return orpcPathOf(action).join('/');
}
