import type { CompiledGate } from './compiled-gate.ts';
import type { FlagSnapshot } from './flag-snapshot.ts';

/** Whether the gate's flag is `true` in the snapshot; without a snapshot, or with anything but `true`, the gate is closed. */
export function gateOpen(gate: CompiledGate, flags: FlagSnapshot | undefined): boolean {
  return flags?.read(gate.key).value === true;
}
