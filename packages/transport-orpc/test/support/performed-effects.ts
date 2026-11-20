import type { Scope } from '@keelwerk/core';

/** The effects the executor of `ping` in the echo app ran: their ids and the scope they ran in. */
export const performedEffects: { readonly id: string; readonly scope: Scope }[] = [];
