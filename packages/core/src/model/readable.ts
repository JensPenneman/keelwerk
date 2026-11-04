import type { ReadableRowAt } from './app-entities.ts';
import type { ModulesOf } from './modules-of.ts';

/**
 * A row as clients receive it (section 8.1, decision 94): computed from the fields, because
 * maskability is a field flag a row type has lost.
 */
export type Readable<P, Ref extends string> = Ref extends `${infer I}.${infer E}`
  ? ReadableRowAt<ModulesOf<P>, I, E>
  : never;
