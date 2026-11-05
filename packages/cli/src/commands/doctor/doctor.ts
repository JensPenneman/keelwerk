import process from 'node:process';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { DoctorFinding } from '../../doctor/doctor-finding.ts';
import { readEnvironmentFacts } from '../../doctor/read-environment-facts.ts';
import { runArtefactCheck } from '../../doctor/run-artefact-check.ts';
import { runDoctor } from '../../doctor/run-doctor.ts';
import { runPnpmVersion } from '../../doctor/run-pnpm-version.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { doctorFlags } from './doctor-flags.ts';
import { findWorkspaceRoot } from './find-workspace-root.ts';
import { loadDeploymentInput } from './load-deployment-input.ts';
import { renderFindings } from './render-findings.ts';

/**
 * `doctor [--layout]` (section 13.12): checks the environment and the project, then the
 * deployment the project's deployment file declares, and names a fix per finding. `--layout`
 * runs the layout pass alone. Findings of severity error make the exit code 1; doctor never edits.
 */
export const doctorCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Check the environment, the project layout and the deployment.',
    fullDescription: [
      'doctor            the environment, tsconfigs, references, manifests, artefacts, named',
      '                  types, declaration sizes, the layout pass and the deployment',
      'doctor --layout   the layout pass alone (section 23.13)',
    ].join('\n'),
  },
  parameters: { flags: doctorFlags() } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    const layoutOnly = parsed.layout === true;
    const root = await findWorkspaceRoot(scoped.host);
    const loaded = layoutOnly
      ? { input: undefined, findings: [] as readonly DoctorFinding[] }
      : await loadDeploymentInput(
          scoped.host,
          typeof parsed.config === 'string' ? parsed.config : undefined,
        );
    const findings = [
      ...(await runDoctor({
        root,
        layoutOnly,
        environment: await readEnvironmentFacts(root, process.version, runPnpmVersion),
        runArtefacts: runArtefactCheck,
        deployment: loaded.input,
        now: Temporal.Instant.fromEpochMilliseconds(scoped.host.now()),
      })),
      ...loaded.findings,
    ];
    if (scoped.output.format === 'text' || scoped.output.format === 'table') {
      scoped.output.line(renderFindings(findings, layoutOnly));
    } else {
      scoped.output.value(findings);
    }
    if (findings.some((finding) => finding.severity === 'error')) scoped.process.exitCode = 1;
  },
});
