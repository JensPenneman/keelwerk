import type { ModuleType } from '@keelwerk/core';
import { defineLive } from './define-live.ts';

/** The live module: provides the `live` contract, fills the core's `liveHub` point with the hub filler (15.4.1; each runtime opens its own hub), its `liveCarriers` point with the SSE and WebSocket carriers and its principal resolvers with the stream ticket resolver, and issues tickets (`live.ticket`), serves the pokes of a scope (`live.pokes`) and, through the `watch` template of its base, `watch` on every entity. */
export interface Live extends ModuleType<ReturnType<typeof defineLive>> {}

/** The live module. */
export const live: Live = defineLive();
