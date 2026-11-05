/** The sources of a project with one module, `shop`, whose `order` entity holds one integer field. */
export function shopSources(field: 'total' | 'amount'): Readonly<Record<string, string>> {
  return {
    'packages/module-shop/src/entities/order.ts': `import { defineEntity, field } from '@keelwerk/core';

export const order = defineEntity({ prefix: 'ord', fields: { ${field}: field.integer() } });
`,
    'packages/module-shop/src/base.ts': `import { defineModuleBase } from '@keelwerk/core';
import { order } from './entities/order.ts';

export const shopBase = defineModuleBase({ id: 'shop', version: '0.1.0', entities: { order } });
`,
    'apps/demo/src/app.ts': `import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';
import { shop } from '../../../packages/module-shop/src/module.generated.ts';

const demoDef = defineApp({
  id: 'demo',
  modules: [shop],
  api: defineApiVersions({ '2026-11-04': {} }),
});

export interface Demo extends AppType<typeof demoDef> {}
export const demo: Demo = demoDef;
`,
  };
}
