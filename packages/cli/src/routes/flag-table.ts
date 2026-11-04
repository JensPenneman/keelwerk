import type { FieldNode, SurfaceAction } from '@keelwerk/core';
import { kebab } from '@keelwerk/core';
import type { FlagEntry } from './flag-entry.ts';
import { isInputField } from './is-input-field.ts';
import { reservedFlags } from './reserved-flags.ts';

function keyFor(
  path: readonly string[],
  node: FieldNode,
): { key: string; role: FlagEntry['role'] } {
  const base = path.map(kebab).join('.');
  if (node.kind === 'secret') {
    return { key: `${base}-stdin`, role: 'stdin' };
  }
  if (node.kind === 'json') {
    return { key: `${base}-json`, role: 'value' };
  }
  return { key: base, role: 'value' };
}

/**
 * The flags of an action: one per input field, kebab-cased, `--no-` forms for booleans (explicit flags, because the case style keeps names as written), dotted
 * flags for the fields of a shape to depth 2, `--name-json` for JSON values and `--name-stdin` for
 * secrets (section 16.9.4). Deeper shapes and free-form schemas are given with `--input`.
 */
export function flagTable(action: SurfaceAction): readonly FlagEntry[] {
  const input = action.input;
  if (input.kind !== 'shape') {
    return [];
  }
  const entries: FlagEntry[] = [];
  const add = (path: readonly string[], node: FieldNode) => {
    const { key, role } = keyFor(path, node);
    if (!reservedFlags.has(key) && !entries.some((entry) => entry.key === key)) {
      entries.push({ key, path, node, role });
      if (node.kind === 'boolean' && !reservedFlags.has(`no-${key}`)) {
        entries.push({ key: `no-${key}`, path, node, role: 'negate' });
      }
    }
  };
  for (const [name, node] of Object.entries(input.fields)) {
    if (!isInputField(node) || (action.instance && (name === 'id' || name === 'ifVersion'))) {
      continue;
    }
    if (node.kind === 'shape') {
      for (const [inner, innerNode] of Object.entries(node.fields)) {
        if (isInputField(innerNode) && innerNode.kind !== 'shape') {
          add([name, inner], innerNode);
        }
      }
    } else if (node.kind !== 'foreign') {
      add([name], node);
    }
  }
  return entries;
}
