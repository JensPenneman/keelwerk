import type { DeploymentDefinition } from '@keelwerk/core';
import { secret } from '@keelwerk/core';

export const keyEnvironment: Record<string, string | undefined> = Object.fromEntries([
  ['KW_KEY', 'x'],
]);

export function definitionOf(over: Partial<DeploymentDefinition> = {}): DeploymentDefinition {
  return {
    apps: [],
    infrastructure: [],
    control: { adapter: 'postgres', url: 'postgres://db1:5432/control' },
    placements: { main: { adapter: 'postgres', url: 'postgres://db1:5432/app' } },
    operator: { socket: '/run/keelwerk.sock' },
    keys: { masterKey: secret('KW_KEY') },
    ...over,
  };
}
