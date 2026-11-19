import { field } from '../fields/field.ts';
import type { Shape } from '../fields/shape.ts';
import { shape } from '../fields/shape.ts';
import { backendQuotasSchema } from './backend-quotas-schema.ts';

/**
 * The configuration the core module itself reads from a backend: how much of the surface
 * `core.introspect` shows (16.2.5), and the backend's quota values (12.2), each a dimension (a
 * declared ref or `queue:<q>.<running|queued|weight>`) to a limit text in the form `core.quota.set`
 * takes. A dimension left out reads the declared default; a tenant's override never goes above it.
 */
export const coreBackendConfig: Shape = shape({
  introspection: field.enum(['public', 'operator']).optional(),
  quotas: field.json(backendQuotasSchema).optional(),
});
