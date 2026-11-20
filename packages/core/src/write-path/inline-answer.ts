import type { RequestAnswerer } from '../kernel/request-answerer.ts';

/** What a `perform` is answered: the outcome of the inline effect as a value. */
export type InlineAnswer = Awaited<ReturnType<RequestAnswerer['perform']>>;
