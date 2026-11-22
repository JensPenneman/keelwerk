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
import { doctorFails } from './doctor-fails.ts';
import { doctorFlags } from './doctor-flags.ts';
import { findWorkspaceRoot } from './find-workspace-root.ts';
import { ignoredFlagNotes } from './ignored-flag-notes.ts';
import { loadDeploymentInput } from './load-deployment-input.ts';
import { renderFindings } from './render-findings.ts';

/**
 * `doctor [--layout] [--strict]` (section 13.12): checks the environment and the project, then the
 * deployment the project's deployment file declares, and names a fix per finding. `--layout`
 * runs the layout pass alone. Findings of severity error make the exit code 1, and with `--strict`
 * so does a finding of severity not-checked, a check doctor has that did not run; doctor never
 * edits.
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
      'doctor --strict   also exit 1 when a check that doctor has did not run',
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
        environment: await readEnvironmentFacts(root, process.version, () =>
          runPnpmVersion(scoped.host),
        ),
        runArtefacts: runArtefactCheck,
        deployment: loaded.input,
      })),
      ...loaded.findings,
      ...ignoredFlagNotes(parsed),
    ];
    if (scoped.output.format === 'text' || scoped.output.format === 'table') {
      scoped.output.line(renderFindings(findings, layoutOnly));
    } else {
      scoped.output.value(findings);
    }
    if (doctorFails(parsed, findings)) scoped.process.exitCode = 1;
  },
});
