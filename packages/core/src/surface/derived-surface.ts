import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { ApiSurface } from './api-surface.ts';

/** A derived surface and the problems met deriving it; an error problem means the surface is incomplete. */
export interface DerivedSurface {
  readonly surface: ApiSurface;
  readonly problems: readonly CompositionProblem[];
}
