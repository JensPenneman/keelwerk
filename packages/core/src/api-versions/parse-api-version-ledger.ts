import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ApiVersionLedger, LedgerEntry } from './api-version-ledger.ts';

function unreadable(message: string): never {
  throw new KeelwerkError({ kind: 'internal', code: 'core.internal', message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entryOf(value: unknown): LedgerEntry {
  if (!isRecord(value)) return unreadable('A ledger entry is not an object.');
  const { version, surfaceHash, modules, changes } = value;
  if (typeof version !== 'string' || typeof surfaceHash !== 'string') {
    return unreadable('A ledger entry needs a version and a surface hash.');
  }
  if (!isRecord(modules) || Object.values(modules).some((item) => typeof item !== 'string')) {
    return unreadable(`The modules of ledger entry '${version}' must map ids to versions.`);
  }
  if (!Array.isArray(changes) || changes.some((item) => typeof item !== 'string')) {
    return unreadable(`The changes of ledger entry '${version}' must be a list of ids.`);
  }
  return {
    version,
    surfaceHash,
    modules: modules as Record<string, string>,
    changes: changes as string[],
  };
}

/** Reads `ledger.json`; a file without the `keelwerk.ledger/1` header is refused, never guessed (section 18.1). */
export function parseApiVersionLedger(text: string): ApiVersionLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return unreadable('The ledger is not valid JSON.');
    throw error;
  }
  if (!isRecord(parsed) || parsed.format !== 'keelwerk.ledger/1') {
    return unreadable("The ledger does not carry the format 'keelwerk.ledger/1'.");
  }
  if (typeof parsed.app !== 'string' || !Array.isArray(parsed.versions)) {
    return unreadable('The ledger needs an app and a list of versions.');
  }
  return { format: 'keelwerk.ledger/1', app: parsed.app, versions: parsed.versions.map(entryOf) };
}
