import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import clean from './layout-fixtures/clean.json' with { type: 'json' };
import { materialise, removeTrees, writeManifests } from './layout-fixtures/materialise-tree.ts';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';

afterEach(removeTrees);

describe('the doctor command on a deployment', () => {
  const configText = [
    "import { maskCapabilities, memoryAdapter } from '@keelwerk/data';",
    '',
    'const inner = memoryAdapter();',
    'const factory = {',
    '  ...inner,',
    '  create: (placement, env) => {',
    '    const adapter = inner.create(placement, env);',
    '    return {',
    '      ...adapter,',
    '      connect: async () =>',
    "        maskCapabilities(await adapter.connect(), ['rowLocks', 'changeFeed', 'search', 'positionPaging', 'broadcast', 'jobs']),",
    '    };',
    '  },',
    '};',
    '',
    'export default {',
    '  apps: [],',
    '  infrastructure: [factory],',
    "  control: { adapter: 'memory' },",
    "  placements: { main: { adapter: 'memory', strategy: 'shared-tables' } },",
    '};',
    '',
  ].join('\n');

  test('opens the adapters and lists the fallbacks of a placement with the accelerations off', async () => {
    const dir = await materialise(clean.files);
    await writeManifests(dir);
    const here = dirname(fileURLToPath(import.meta.url));
    const configDir = await mkdtemp(join(here, '.doctor-config-'));
    try {
      const config = join(configDir, 'keelwerk.config.ts');
      await writeFile(config, configText);
      const host = createFakeHost({
        cwd: dir,
        files: {
          [`${dir}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n',
          [config]: '',
        },
      });
      const result = await runCliWith(
        ['doctor', '--config', config, '--output', 'json'],
        host.host,
      );
      const findings = JSON.parse(result.stdout) as {
        check: string;
        subject: string;
        message: string;
      }[];
      const fallbacks = findings.filter((finding) => finding.check === 'fallbacks');
      expect(fallbacks.some((finding) => finding.message.includes('was not opened'))).toBe(false);
      expect(
        fallbacks.filter((finding) => finding.subject === 'main').map((finding) => finding.message),
      ).toContainEqual(expect.stringContaining('rowLocks is absent'));
      expect(fallbacks.some((finding) => finding.subject === 'control')).toBe(true);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  }, 60_000);
});
