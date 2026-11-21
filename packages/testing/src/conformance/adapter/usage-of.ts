import { conformanceScopes } from '@keelwerk/data/conformance';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA } = conformanceScopes;

/** The counter of a dimension in a scope, read in a unit of its own; the first tenant by default. */
export function usageOf(subject: Pick<ConformanceSubject, 'read'>) {
  return (dimension = 'core.rows', scope: Parameters<ConformanceSubject['read']>[0] = tenantA) =>
    subject.read(scope, (unit) => unit.usage.get(dimension));
}
