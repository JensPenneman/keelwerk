import type { AppEntities } from './app-entities.ts';

/** One row type of an app: `Row<Portal, 'accounts.profile'>`. */
export type Row<P, Ref extends string> = Ref extends `${infer M}.${infer E}`
  ? AppEntities<P> extends infer En
    ? M extends keyof En
      ? E extends keyof En[M]
        ? En[M][E]
        : never
      : never
    : never
  : never;
