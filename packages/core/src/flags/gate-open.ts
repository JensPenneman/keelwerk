import type { Registry } from '../registry/registry.ts';
import type { CompiledGate } from './compiled-gate.ts';
import type { FlagSnapshot } from './flag-snapshot.ts';
import { flagSpecOf } from './flag-spec-of.ts';

/** Whether the gate's flag is `true`: from the snapshot, else the declared default; anything else is closed. */
export function gateOpen(
  registry: Registry,
  gate: CompiledGate,
  flags: FlagSnapshot | undefined,
): boolean {
  const value =
    flags === undefined ? flagSpecOf(registry, gate.key)?.default : flags.read(gate.key).value;
  return value === true;
}
