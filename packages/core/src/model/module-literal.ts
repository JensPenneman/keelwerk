import type { Behaviour } from './behaviour.ts';

type Parts = { readonly [name: string]: object };

/** The module literal: mounts the parts under keys that are ids (section 4.1). */
export interface ModuleLiteral extends Behaviour {
  readonly services?: Parts;
  readonly topics?: Parts;
  readonly contributes?: { readonly [key: string]: Behaviour };
  readonly conditional?: { readonly [key: string]: Behaviour };
  readonly schedules?: Parts;
  readonly lifecycle?: Parts;
  readonly changes?: Parts;
  readonly effects?: Parts;
  readonly executors?: Parts;
}
