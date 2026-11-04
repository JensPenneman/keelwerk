import type { FlagEntry } from './flag-entry.ts';
import type { PositionalSlot } from './positional-slot.ts';

/** A usage example derived from the input shape: the positionals, then up to three flags. */
export function exampleLine(
  reference: string,
  slots: readonly PositionalSlot[],
  entries: readonly FlagEntry[],
): string {
  const positionals = slots.map((slot) => `<${slot.name}>`);
  const flags = entries
    .filter((entry) => !entry.node.optional)
    .concat(entries.filter((entry) => entry.node.optional))
    .slice(0, 3)
    .map((entry) =>
      entry.node.kind === 'boolean' ? `--${entry.key}` : `--${entry.key} <${entry.node.kind}>`,
    );
  return ['keelwerk', 'call', reference, ...positionals, ...flags].join(' ').trimEnd();
}
