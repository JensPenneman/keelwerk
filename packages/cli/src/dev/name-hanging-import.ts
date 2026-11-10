import { fileURLToPath } from 'node:url';
import { eventMarker } from './event-marker.ts';

/**
 * The module a child was evaluating when it was stopped, from the events `trackImports` printed:
 * the first module that was imported, never finished, and whose own imports all finished. A module
 * evaluates after the modules it imports, so that one is the module that is waiting. Only the
 * imports after the last `step` count: the probe reports a step after its awaited work returned or
 * threw, so an import before it that never finished failed and is not what the probe waits on.
 */
export function nameHangingImport(stderr: string): string | undefined {
  const order: string[] = [];
  const imports = new Map<string, Set<string>>();
  const done = new Set<string>();
  for (const line of stderr.split('\n')) {
    if (!line.startsWith(`${eventMarker} `)) continue;
    const [kind, first, second] = line.slice(eventMarker.length + 1).split(' ');
    if (kind === 'step') {
      order.length = 0;
      imports.clear();
    }
    if (kind === 'done' && first !== undefined) done.add(first);
    if (kind === 'import' && first !== undefined && second !== undefined) {
      if (!imports.has(second)) {
        order.push(second);
        imports.set(second, new Set());
      }
      imports.get(first)?.add(second);
    }
  }
  const waiting = order.find(
    (file) => !done.has(file) && [...(imports.get(file) ?? [])].every((child) => done.has(child)),
  );
  return waiting === undefined ? undefined : fileURLToPath(waiting);
}
