import type { InvokeResponse } from '@keelwerk/core';

/** The effect references an invocation answer reports, exactly as the envelope of the core carries them. */
export type EffectReferences = NonNullable<Extract<InvokeResponse, { ok: true }>['effects']>;
