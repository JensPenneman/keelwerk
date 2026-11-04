import type { KeelwerkError } from '@keelwerk/core';

/** An error of the core's taxonomy (`core.*` codes), which any action can answer with. */
export type TaxonomyError = KeelwerkError & { readonly code: `core.${string}` };
