import type { ApiSurface, FieldNode, SurfaceAction } from '@keelwerk/core';

const base = { optional: false, access: 'read-write' } as const;

function shapeOf(fields: Readonly<Record<string, FieldNode>>): FieldNode {
  return { ...base, kind: 'shape', fields };
}

const voidNode: FieldNode = { ...base, kind: 'void' };
const instant: FieldNode = { ...base, kind: 'instant' };
const text: FieldNode = { ...base, kind: 'string' };
const wide: FieldNode = { ...base, kind: 'integer', wide: true };
const small: FieldNode = { ...base, kind: 'integer', wide: false };

function action(
  ref: string,
  kind: SurfaceAction['kind'],
  execution: SurfaceAction['execution'],
  input: FieldNode,
  output: FieldNode,
  errors: readonly string[] = [],
): SurfaceAction {
  const name = ref.split('.').at(-1) ?? ref;
  return {
    ref,
    module: 'shop',
    name,
    mount: 'module',
    kind,
    instance: false,
    input,
    output,
    errors,
    auth: 'policy',
    scope: 'tenant',
    execution,
    idempotent: kind === 'command',
    offline: false,
    resumable: false,
    hints: {},
    since: '2026-11-01',
    changedIn: [],
    inputHash: 'sha256-x',
    outputHash: 'sha256-y',
  };
}

/** The surface of the probe app at `apiVersion`. */
export function probeSurface(apiVersion = '2026-11-01'): ApiSurface {
  return {
    format: 'keelwerk.surface/1',
    app: 'shop',
    apiVersion,
    hash: 'sha256-probe',
    modules: [{ id: 'shop', version: '1.0.0' }],
    entities: [],
    actions: [
      action(
        'shop.total',
        'query',
        'sync',
        shapeOf({ since: instant }),
        shapeOf({ total: wide, at: instant }),
      ),
      action(
        'shop.place',
        'command',
        'either',
        shapeOf({ sku: text, quantity: wide }),
        shapeOf({ orderId: text, placedAt: instant }),
        ['shop.sold_out'],
      ),
      action('shop.cancelAll', 'command', 'async', shapeOf({}), shapeOf({ cancelled: small })),
      action('shop.ping', 'command', 'sync', voidNode, voidNode),
    ],
    errors: [
      {
        code: 'shop.sold_out',
        kind: 'conflict',
        message: 'Sold out.',
        retryable: false,
        data: shapeOf({ sku: text, left: wide }),
      },
    ],
    events: [],
  };
}
