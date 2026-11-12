import type { LiveCarrier } from '@keelwerk/core';
import { streamApp } from './stream-runtime.ts';

/** The WebSocket carrier the live module fills, found in the composed registry as a host finds it. */
export function realWebsocketCarrier(): LiveCarrier {
  for (const entry of streamApp.registry.fills.get('core.liveCarriers') ?? []) {
    const value = entry.fill as { readonly name?: string };
    if (value.name === 'websocket') return value as LiveCarrier;
  }
  throw new Error('the stream app fills no websocket carrier');
}
