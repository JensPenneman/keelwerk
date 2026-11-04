import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { generateManifest } from './generate-manifest.ts';

const fixtures = join(import.meta.dirname, '..', 'src', 'fixtures');
for (const id of ['accounts', 'teams', 'auth', 'hooks']) {
  const dir = join(fixtures, id);
  writeFileSync(
    join(dir, 'module.generated.ts'),
    generateManifest(dir, id, '../../define-module.ts'),
  );
  process.stdout.write(`wrote ${join(dir, 'module.generated.ts')}\n`);
}
