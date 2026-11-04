import type { LedgerSink } from '../kernel/ledger-sink.ts';
import type { SecretProvider } from '../kernel/secret-provider.ts';
import type { DataAdapterFactory } from '../storage/data-adapter-factory.ts';
import type { TransportHost } from '../transport/transport-host.ts';
import type { FallbackReporter } from './fallback-reporter.ts';
import type { SchemaPlanner } from './schema-planner.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAdapterFactory(value: unknown): value is DataAdapterFactory {
  return isRecord(value) && typeof value.id === 'string' && typeof value.create === 'function';
}

function isLedgerSink(value: unknown): value is LedgerSink {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.append === 'function' &&
    typeof value.read === 'function'
  );
}

function isSecretProvider(value: unknown): value is SecretProvider {
  return isRecord(value) && typeof value.id === 'string' && typeof value.resolve === 'function';
}

function isSchemaPlanner(value: unknown): value is SchemaPlanner {
  return isRecord(value) && value.kind === 'schemaPlanner';
}

function isFallbackReporter(value: unknown): value is FallbackReporter {
  return isRecord(value) && value.kind === 'fallbackReporter';
}

function isHost(value: unknown): value is TransportHost {
  return isRecord(value) && typeof value.route === 'function' && typeof value.fetch === 'function';
}

/** The entries of `defineDeployment({ infrastructure })` sorted by what they fill (section 5.6). */
export interface RuntimeInfrastructure {
  readonly adapters: ReadonlyMap<string, DataAdapterFactory>;
  readonly ledgers: readonly LedgerSink[];
  readonly secretProviders: readonly SecretProvider[];
  readonly planner: SchemaPlanner | undefined;
  readonly fallbackReporter: FallbackReporter | undefined;
  readonly host: TransportHost | undefined;
  /** The contracts the entries provide. */
  readonly provided: ReadonlySet<string>;
}

/**
 * Sorts the deployment's infrastructure by shape: a data adapter factory, a ledger sink, a secret
 * provider, the schema planner, the fallback reporter, and an entry that carries the HTTP host in its `host` member (or
 * is one). Anything else is kept for the contracts it provides.
 */
export function runtimeInfrastructure(entries: readonly unknown[]): RuntimeInfrastructure {
  const adapters = new Map<string, DataAdapterFactory>();
  const ledgers: LedgerSink[] = [];
  const secretProviders: SecretProvider[] = [];
  const provided = new Set<string>();
  let planner: SchemaPlanner | undefined;
  let fallbackReporter: FallbackReporter | undefined;
  let host: TransportHost | undefined;
  for (const entry of entries) {
    if (isAdapterFactory(entry)) adapters.set(entry.id, entry);
    if (isLedgerSink(entry)) ledgers.push(entry);
    if (isSecretProvider(entry)) secretProviders.push(entry);
    if (isSchemaPlanner(entry)) planner = entry;
    if (isFallbackReporter(entry)) fallbackReporter = entry;
    if (isHost(entry)) host = entry;
    if (isRecord(entry) && isHost(entry.host)) host = entry.host;
    if (isRecord(entry) && Array.isArray(entry.provides)) {
      for (const contract of entry.provides as readonly unknown[]) {
        if (isRecord(contract) && typeof contract.contract === 'string') {
          provided.add(contract.contract);
        }
      }
    }
  }
  return { adapters, ledgers, secretProviders, planner, fallbackReporter, host, provided };
}
