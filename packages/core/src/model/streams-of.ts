import type { Empty } from '../types/empty.ts';

/** The streams a module base lists (`defineModuleBase({ streams })`). */
export type StreamsOf<M> = M extends { readonly streams: infer Ss } ? Ss : Empty;
