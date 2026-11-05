import { controlNamespace, namespaceRootOf } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { namespaceOf } from '../src/db/namespace-of.ts';
import { renderSteps } from '../src/db/render-steps.ts';

test('the namespace root of an app is the runtime rule: dashes become underscores', () => {
  expect(namespaceOf('main', 'my-shop-app').root).toBe(namespaceRootOf('my-shop-app'));
  expect(namespaceRootOf('my-shop-app')).toBe('my_shop_app');
  expect(renderSteps('my-shop-app', []).join('\n')).not.toContain('my-shop-app');
});

test('the control namespace is the runtime one, on the placement named control', () => {
  expect(controlNamespace('control')).toEqual({
    id: 'ns-control',
    placementId: 'control',
    appId: 'core',
    tenantId: null,
    root: 'kw__control',
  });
});
