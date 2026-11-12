import type { AnyActionPart } from './action-part.ts';

type Parts = { readonly [name: string]: object };
type Actions = { readonly [name: string]: AnyActionPart };
/** A rule mounted directly under its key: a rule over a selector or several actions (section 23.2). */
type FlatRule = { readonly kind: 'rule' };

/** The behaviour half of a contribution or conditional part. */
export interface Behaviour {
  readonly actions?: Actions;
  readonly entityActions?: { readonly [entity: string]: Actions };
  readonly policies?: { readonly [target: string]: Parts | FlatRule };
  readonly reactions?: Parts;
  readonly extensionPoints?: Parts;
}
