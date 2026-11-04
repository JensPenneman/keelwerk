import type { AppliedPart } from './applied-part.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { ExtensionFillEntry } from './extension-fill-entry.ts';
import type { ExtensionPointEntry } from './extension-point-entry.ts';
import type { PartMap, RuntimeModule } from './runtime-module.ts';

function isFillPart(value: unknown): value is { readonly kind: 'fill'; readonly factory: unknown } {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'fill';
}

function orderOf(value: unknown): number | undefined {
  const order: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'order') : undefined;
  return typeof order === 'number' ? order : undefined;
}

/** The fills per point reference, in fill order, and the problems met. */
export interface BoundFills {
  readonly fills: ReadonlyMap<string, readonly ExtensionFillEntry[]>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * Binds the values modules put into extension points (section 5.5): a `defineFill` part is a
 * factory bound to its contributor (gap G16), anything else a plain value; a list fills one entry per element. Contributions fill the
 * points of their target, a module's own `extensionPoints` mount fills its own points. A fill for a
 * point nobody declares is `unknownExtensionPoints`; a `single` point with several fillers is
 * `singleExtensionPointFillers`; `ordered` points sort by declared `order`, then module order.
 * Empty slots (`min`, or a `single` point without a filler) are warnings: the kernel refuses them at boot.
 */
export function bindExtensionFills(
  ordered: readonly RuntimeModule[],
  parts: readonly AppliedPart[],
  points: ReadonlyMap<string, ExtensionPointEntry>,
): BoundFills {
  const fills = new Map<string, ExtensionFillEntry[]>([...points.keys()].map((ref) => [ref, []]));
  const problems: CompositionProblem[] = [];
  const bind = (values: PartMap, targetModule: string, contributor: string): void => {
    for (const [name, value] of Object.entries(values)) {
      const point = `${targetModule}.${name}`;
      const slot = fills.get(point);
      if (slot === undefined) {
        problems.push(
          compositionError(
            'unknownExtensionPoints',
            `'${contributor}' fills '${point}', which no module declares.`,
            {
              module: contributor,
              ref: point,
            },
          ),
        );
        continue;
      }
      for (const item of Array.isArray(value) ? (value as readonly unknown[]) : [value]) {
        const bound = isFillPart(item);
        const order = orderOf(item);
        slot.push({
          point,
          module: contributor,
          bound,
          fill: bound ? item.factory : item,
          ...(order === undefined ? {} : { order }),
        });
      }
    }
  };
  for (const module of ordered) {
    bind(module.fills, module.id, module.id);
    for (const part of parts) {
      if (part.active && part.declaredBy === module) bind(part.fills, part.target, module.id);
    }
  }
  for (const [ref, point] of points) {
    const slot = fills.get(ref) ?? [];
    if (point.mode === 'ordered') {
      slot.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    }
    if (point.mode === 'single' && slot.length > 1) {
      problems.push(
        compositionError(
          'singleExtensionPointFillers',
          `'${ref}' takes one filler and has ${slot.length}.`,
          {
            module: point.module,
            ref,
          },
        ),
      );
    }
    const needed = point.mode === 'single' && !point.hasDefault ? 1 : (point.min ?? 0);
    if (slot.length < needed) {
      problems.push({
        code: 'emptyExtensionPoints',
        severity: 'warning',
        message: `'${ref}' has ${slot.length} of the ${needed} fillers it needs.`,
        module: point.module,
        ref,
      });
    }
  }
  return { fills, problems };
}
