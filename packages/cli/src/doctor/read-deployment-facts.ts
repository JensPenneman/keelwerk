import type { DeploymentDefinition, SecretRef } from '@keelwerk/core';
import { absent } from './absent.ts';
import { capabilitiesUsed } from './capabilities-used.ts';
import { clusterOf } from './cluster-of.ts';
import type { ControlReader } from './control-reader.ts';
import type { DeploymentFacts } from './deployment-facts.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { Fact } from './fact.ts';
import { fallbackReporterOf } from './fallback-reporter-of.ts';
import { known } from './known.ts';
import { messageOf } from './message-of.ts';
import { personalFieldsOf } from './personal-fields-of.ts';
import { secretPresent } from './secret-present.ts';
import { sqlNeedsOf } from './sql-needs-of.ts';

const notAnswering =
  'check that the control store answers at the url of the deployment file, then run doctor again';

/** A fact read through the control reader: the reason the reader is absent, or absent with the message when the read fails. */
async function readerFact<T>(
  reader: Fact<ControlReader>,
  read: (reader: ControlReader) => Promise<T>,
): Promise<Fact<T>> {
  if (!reader.known) return reader;
  try {
    return known(await read(reader.value));
  } catch (error) {
    return absent(`the control store could not be read: ${messageOf(error)}`, notAnswering);
  }
}

/** The reader the other facts are read through: none when the reachability read found that the store does not answer. */
function readerAfter(
  reader: Fact<ControlReader>,
  reachable: DeploymentFacts['controlReachable'],
): Fact<ControlReader> {
  return reachable.known && !reachable.value.reachable
    ? absent(`the control store did not answer: ${reachable.value.detail}`, notAnswering)
    : reader;
}

async function socketFact(input: DeploymentInput): Promise<DeploymentFacts['socket']> {
  const path = input.definition.operator?.socket;
  if (path === undefined) return known(null);
  const mode = await input.modeOf(path);
  return mode === undefined
    ? absent(
        `the operator socket ${path} is declared and there is no file there where doctor runs`,
        'run doctor on the machine that serves the operator socket, or correct `operator.socket`',
      )
    : known({ path, mode });
}

async function masterKeyFact(input: DeploymentInput): Promise<DeploymentFacts['masterKey']> {
  const ref: SecretRef | undefined = input.definition.keys?.masterKey;
  if (ref === undefined) return known({ declared: false, present: false });
  try {
    return known({
      declared: true,
      present: await secretPresent(ref, input.definition.infrastructure, input.env),
    });
  } catch (error) {
    return absent(
      `a secret provider failed to answer: ${messageOf(error)}`,
      'repair the secret provider named in the deployment file, then run doctor again',
    );
  }
}

function clustersFact(input: DeploymentInput): DeploymentFacts['clusters'] {
  const { definition, env } = input;
  const control = clusterOf(definition.control, env);
  const placements = Object.entries(definition.placements).map(([name, entry]) => ({
    name,
    cluster: clusterOf(entry, env),
  }));
  const located = placements.flatMap((entry) =>
    entry.cluster === undefined ? [] : [{ name: entry.name, cluster: entry.cluster }],
  );
  if (control === undefined || located.length < placements.length) {
    const unset = [
      ...(control === undefined ? ['control'] : []),
      ...placements.filter((entry) => entry.cluster === undefined).map((entry) => entry.name),
    ];
    return absent(
      `the url of ${unset.join(', ')} reads an environment variable that is not set`,
      'set the environment variable the url reads, then run doctor again',
    );
  }
  return known({ control, placements: located });
}

function ledgerSinksOf(definition: DeploymentDefinition): number {
  return definition.infrastructure.filter(
    (entry) => typeof entry === 'object' && entry !== null && 'append' in entry && 'read' in entry,
  ).length;
}

/**
 * Collects what the checks judge, every fact a value or a reason: the deployment definition, the
 * environment, the apps' declarations, the capabilities of the adapters doctor opened and, through
 * the reader, the rows of the control store. A fact doctor has no source for is absent.
 */
export async function readDeploymentFacts(input: DeploymentInput): Promise<DeploymentFacts> {
  const { definition, registries } = input;
  const controlReachable = await readerFact(input.reader, (reader) => reader.reachable());
  const reader = readerAfter(input.reader, controlReachable);
  return {
    socket: await socketFact(input),
    masterKey: await masterKeyFact(input),
    clusters: clustersFact(input),
    ledgerSinks: known(ledgerSinksOf(definition)),
    controlReachable,
    hookFailures: await readerFact(reader, (source) => source.hookFailures()),
    processes: await readerFact(reader, (source) => source.processes()),
    bumpedMarks: await readerFact(reader, (source) => source.bumpedMarks()),
    heldTenants: await readerFact(reader, (source) => source.heldTenants()),
    registries: known(registries),
    personalFields: known(personalFieldsOf(registries)),
    sqlNeeds: known(sqlNeedsOf(definition.apps)),
    fallbackReporter: known(fallbackReporterOf(definition.infrastructure)),
    capabilitiesUsed: known(registries.length === 0 ? undefined : capabilitiesUsed(registries)),
    placements: input.placements,
  };
}
