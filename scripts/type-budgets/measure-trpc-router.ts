import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateSyntheticApps } from './generate-synthetic-apps.ts';
import { parseExtendedDiagnostics } from './parse-extended-diagnostics.ts';
import { runTsc } from './run-tsc.ts';
import { throwOnCompileErrors } from './throw-on-compile-errors.ts';

const client = `import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { keelwerkSuperjson, type TrpcRouterOf } from '@keelwerk/transport-trpc';
import type { SyntheticApp } from './app.ts';

const trpc = createTRPCClient<TrpcRouterOf<SyntheticApp>>({
  links: [httpBatchLink({ url: 'http://localhost/trpc', transformer: keelwerkSuperjson() })],
});

export const queried = trpc.m25.a.get.query({ ids: [] });
export const mutated = trpc.m25.a.create.mutate({ name: 'x' });
export const subscribed = trpc.m25.a.watch.subscribe(
  { from: 'beginning' },
  { onData: () => undefined },
);
`;

/** A directory link, as the generator makes them: `from` becomes a link to `to`. */
function linkPackage(from: string, to: string): void {
  mkdirSync(dirname(from), { recursive: true });
  symlinkSync(to, from, 'dir');
}

/** The fold of the app project: the count of `tsc -p app/tsconfig.json` with a fresh build info. */
function foldOf(repo: string, root: string, label: string): number {
  rmSync(join(root, 'app', 'tsconfig.tsbuildinfo'), { force: true });
  const output = runTsc(repo, ['-p', join('app', 'tsconfig.json'), '--extendedDiagnostics'], root);
  throwOnCompileErrors(label, output, []);
  return parseExtendedDiagnostics(output).instantiations;
}

/**
 * Instantiations that `createTRPCClient<TrpcRouterOf<SyntheticApp>>` and one `.query`, one `.mutate`
 * and one `.subscribe` add to the 25-module synthetic app's fold: the app project measured with and
 * without `src/trpc-client.ts`, after linking `@keelwerk/transport-trpc` (packages/transport-trpc)
 * and `@trpc/client`, `@trpc/server` (realpaths from packages/transport-trpc/node_modules) into the
 * app and referencing transport-trpc. Throws on a compile error, as measureRaw does.
 */
export function measureTrpcRouter(repo: string, scratch: string): number {
  const root = join(scratch, 'trpc-router-25');
  generateSyntheticApps(root, 25, repo, { live: true });
  const built = runTsc(repo, ['-b', 'tsconfig.json'], root);
  throwOnCompileErrors('synthetic workspace of 25 modules with live, tsc -b', built, []);
  const transport = join(repo, 'packages', 'transport-trpc');
  const app = join(root, 'app');
  linkPackage(join(app, 'node_modules', '@keelwerk', 'transport-trpc'), transport);
  for (const name of ['client', 'server']) {
    linkPackage(
      join(app, 'node_modules', '@trpc', name),
      realpathSync(join(transport, 'node_modules', '@trpc', name)),
    );
  }
  const config = join(app, 'tsconfig.json');
  const parsed = JSON.parse(readFileSync(config, 'utf8')) as {
    references: { path: string }[];
  };
  parsed.references.push({ path: transport });
  writeFileSync(config, JSON.stringify(parsed));
  const without = foldOf(repo, root, 'synthetic app without the tRPC client, fold');
  writeFileSync(join(app, 'src', 'trpc-client.ts'), client);
  const withClient = foldOf(repo, root, 'synthetic app with the tRPC client, fold');
  return withClient - without;
}
