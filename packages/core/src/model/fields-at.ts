import type { EntityFields } from './app-entities.ts';
import type { ModulesOf } from './modules-of.ts';

/** The active fields of the entity `Ref` ('module.entity') of an app. */
export type FieldsAt<P, Ref> = Ref extends `${infer I}.${infer E}`
  ? EntityFields<ModulesOf<P>, I, E>
  : never;
