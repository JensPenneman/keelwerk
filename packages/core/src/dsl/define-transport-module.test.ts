import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { core } from '../core-module/module.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import { byHostname } from './by-hostname.ts';
import { contracts } from './contracts.ts';
import { defineApp } from './define-app.ts';
import { defineDeployment } from './define-deployment.ts';
import { defineTransportModule } from './define-transport-module.ts';

const adapter: TransportAdapter = {
  name: 'rest',
  capabilities: { streaming: [], batching: false, binary: false },
  static: {},
  check: () => [],
  artifacts: () => [],
  mount: () => Promise.resolve({ close: () => Promise.resolve() }),
};

describe('defineTransportModule (section 5.6)', () => {
  const rest = defineTransportModule({
    id: 'rest',
    requires: [contracts.httpHost],
    config: shape({ docs: field.boolean().default(false) }),
    transport: adapter,
  });

  test('expands to a module that contributes its adapter to the core', () => {
    expect(rest.kind).toBe('module');
    expect(rest.id).toBe('rest');
    expect(rest.requires).toEqual([contracts.httpHost]);
    expect(rest.base.config).toBeDefined();
    expect(rest.contributes).toHaveLength(1);
    const [toCore] = rest.contributes;
    expect(toCore?.to).toBe(core);
    expect(toCore?.fills).toEqual({ transports: [adapter] });
  });

  test('is listed like any module and makes the deployment need an http host', () => {
    const app = defineApp({ id: 'portal', modules: [accounts, rest] });
    expect(app.modules.map((module) => module.id)).toEqual(['core', 'accounts', 'rest']);
    const members = {
      control: { adapter: 'postgres', url: 'postgres://control' },
      placements: {
        default: { adapter: 'postgres', url: 'postgres://data', strategy: 'shared-tables' },
      },
      tenantResolution: [byHostname()],
    } as const;
    expect(() =>
      defineDeployment({ ...members, apps: [app], infrastructure: [] } as never),
    ).toThrow(/httpHost/);
    expect(() =>
      defineDeployment({
        ...members,
        apps: [app],
        infrastructure: [{ kind: 'http', provides: [contracts.httpHost] }],
      }),
    ).not.toThrow();
  });
});
