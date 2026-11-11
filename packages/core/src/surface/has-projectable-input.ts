import type { SurfaceAction } from './surface-action.ts';

/**
 * Whether a transport can project the input of an action (decision S-153): a shape, a foreign
 * schema or no input. Any other kind is the open node a custom non-shape input becomes. Every
 * projection (REST, GraphQL, tRPC, oRPC) refuses an action whose input this rejects with
 * `unsupportedShape` at check and at mount. It does not decide exposure: a hidden action is the
 * caller's own business.
 */
export function hasProjectableInput(action: Pick<SurfaceAction, 'input'>): boolean {
  return (
    action.input.kind === 'shape' || action.input.kind === 'foreign' || action.input.kind === 'void'
  );
}
