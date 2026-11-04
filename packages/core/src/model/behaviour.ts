import type { AnyActionPart } from './action-part.ts';

type Parts = { readonly [name: string]: object };
type Actions = { readonly [name: string]: AnyActionPart };

/** The behaviour half of a contribution or conditional part. */
export interface Behaviour {
  readonly actions?: Actions;
  readonly entityActions?: { readonly [entity: string]: Actions };
  readonly policies?: { readonly [target: string]: Parts };
  readonly reactions?: Parts;
  readonly extensionPoints?: Parts;
}
