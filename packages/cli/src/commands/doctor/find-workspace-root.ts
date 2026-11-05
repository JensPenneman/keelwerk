import type { CliHost } from '../../context/cli-host.ts';

/** The nearest directory from the working directory up that holds `pnpm-workspace.yaml`; the working directory itself when none does. */
export async function findWorkspaceRoot(host: CliHost): Promise<string> {
  let directory = host.cwd;
  for (;;) {
    const marker = directory === '/' ? '/pnpm-workspace.yaml' : `${directory}/pnpm-workspace.yaml`;
    if (await host.files.exists(marker)) return directory;
    const cut = directory.lastIndexOf('/');
    if (cut <= 0) return host.cwd;
    directory = directory.slice(0, cut);
  }
}
