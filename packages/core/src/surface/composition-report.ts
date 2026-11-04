import { compareCodePoints } from '../conditions/compare-code-points.ts';
import type { ExtensionFillEntry } from '../registry/extension-fill-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type {
  CompositionContributionReport,
  CompositionReportDocument,
} from './composition-report-document.ts';

function sortedRecord<V>(record: Readonly<Record<string, V>>): Record<string, V> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => compareCodePoints(left, right)),
  );
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareCodePoints);
}

/** The fillers of a point; a `set` has no order, so its fillers go by module and the tuple order never shows. */
function fillersOf(
  fills: readonly ExtensionFillEntry[],
  mode: 'set' | 'ordered' | 'single',
): CompositionReportDocument['extensionPoints'][number]['fillers'] {
  const fillers = fills.map((fill) => ({
    module: fill.module,
    bound: fill.bound,
    ...(fill.order === undefined ? {} : { order: fill.order }),
  }));
  return mode === 'set'
    ? fillers.sort((left, right) => compareCodePoints(left.module, right.module))
    : fillers;
}

/**
 * The composition report of an app (section 16.2.6): modules with their `requires` and `optional`
 * lists, active and dropped contributions and conditional parts with the reason, extension points
 * and their fillers, the effective policy rules and the problems the composition found. Pure and
 * sorted, so two apps with the same modules in another tuple order report the same.
 */
export function compositionReport(registry: Registry): CompositionReportDocument {
  return {
    format: 'keelwerk.composition/1',
    app: registry.app,
    modules: registry.modules
      .map((module) => ({
        id: module.id,
        version: module.version,
        requires: sortedStrings(module.requires),
        optional: sortedStrings(module.optional),
        provides: sortedStrings(module.provides),
        needs: sortedStrings(module.needs),
      }))
      .sort((left, right) => compareCodePoints(left.id, right.id)),
    contributions: registry.contributions
      .map(
        (entry): CompositionContributionReport => ({
          id: entry.id,
          kind: entry.kind,
          from: entry.from,
          to: entry.to,
          when: sortedStrings(entry.when),
          active: entry.active,
          ...(entry.droppedBecause === undefined ? {} : { droppedBecause: entry.droppedBecause }),
          fields: sortedRecord(
            Object.fromEntries(
              Object.entries(entry.fields).map(([ref, names]) => [ref, sortedStrings(names)]),
            ),
          ),
          actions: sortedStrings(entry.actions),
          rules: sortedStrings(entry.rules),
          reactions: sortedStrings(entry.reactions),
          fills: sortedStrings(entry.fills),
        }),
      )
      .sort((left, right) => compareCodePoints(left.id, right.id)),
    extensionPoints: [...registry.extensionPoints.values()]
      .map((point) => ({
        ref: point.ref,
        module: point.module,
        name: point.name,
        mode: point.mode,
        ...(point.min === undefined ? {} : { min: point.min }),
        hasDefault: point.hasDefault,
        fillers: fillersOf(registry.fills.get(point.ref) ?? [], point.mode),
      }))
      .sort((left, right) => compareCodePoints(left.ref, right.ref)),
    rules: [...registry.rules.values()]
      .map((rule) => ({
        id: rule.id,
        module: rule.module,
        effect: rule.effect,
        subject: rule.subject,
        actions: sortedStrings(rule.actions),
        ...(rule.principal === undefined ? {} : { principal: rule.principal }),
        ...(rule.fields === undefined ? {} : { fields: sortedStrings(rule.fields) }),
        ...(rule.reason === undefined ? {} : { reason: rule.reason }),
        ...(rule.contributedBy === undefined ? {} : { contributedBy: rule.contributedBy }),
        disabled: rule.disabled,
        conditions: {
          where: typeof rule.where === 'function',
          check: typeof rule.check === 'function',
          when: typeof rule.when === 'function',
        },
      }))
      .sort((left, right) => compareCodePoints(left.id, right.id)),
    problems: [...registry.problems].sort(
      (left, right) =>
        compareCodePoints(left.code, right.code) ||
        compareCodePoints(left.ref ?? '', right.ref ?? ''),
    ),
  };
}
