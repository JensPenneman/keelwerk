import type { LiveCarrier } from '@keelwerk/core';
import { streamApp } from './stream-runtime.ts';

/** The server-sent events carrier the live module fills, found in the composed registry as a host finds it. */
export function realSseCarrier(): LiveCarrier {
  for (const entry of streamApp.registry.fills.get('core.liveCarriers') ?? []) {
    const value = entry.fill as { readonly name?: string };
    if (value.name === 'sse') return value as LiveCarrier;
  }
  throw new Error('the stream app fills no sse carrier');
}
