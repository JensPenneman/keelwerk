import { field } from '../fields/field.ts';
import type { Shape } from '../fields/shape.ts';
import { shape } from '../fields/shape.ts';

/** The configuration the core module itself reads from a backend: how much of the surface `core.introspect` shows (16.2.5). */
export const coreBackendConfig: Shape = shape({
  introspection: field.enum(['public', 'operator']).optional(),
});
