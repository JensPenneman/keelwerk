import type { DeploymentCheck } from './deployment-check.ts';
import type { PersonalFieldFact } from './deployment-facts.ts';
import { unfedCheck } from './unfed-check.ts';

const deployment = (name: string, reason: string): DeploymentCheck =>
  unfedCheck({ group: 'deployment', name, needs: [], reason });

const anchors = (name: string, reason: string): DeploymentCheck =>
  unfedCheck({
    group: 'anchors',
    name,
    needs: ['ledgerSinks'],
    applies: ({ ledgerSinks }) => ledgerSinks > 0,
    reason,
  });

const personal = (
  name: string,
  reason: string,
  applies: (fields: readonly PersonalFieldFact[]) => boolean,
): DeploymentCheck =>
  unfedCheck({
    group: 'personal-fields',
    name,
    needs: ['personalFields'],
    applies: ({ personalFields }) => applies(personalFields),
    reason,
  });

const anyField = (fields: readonly unknown[]): boolean => fields.length > 0;

/**
 * The checks no source in the repository feeds. Each one prints a note that doctor does not check
 * it, with its reason, when its `applies` is not false and whenever a fact it needs is absent, and
 * judges nothing: the package that feeds it writes its judge.
 */
export const unfedChecks: readonly DeploymentCheck[] = [
  deployment('external-table drift', 'nothing compares external tables with their mappings'),
  deployment('dead letters', 'no store member counts dead jobs'),
  deployment('parked streams', 'no read of a consumer lists its parked streams within a bound'),
  deployment('capped lanes', 'no read gives the load of a lane'),
  deployment('unplaceable work', 'no process records which capabilities it has'),
  unfedCheck({
    group: 'queues',
    name: 'queues that hold work and have no worker',
    needs: [],
    reason:
      'no bounded read tells whether a queue holds jobs, and no process records which queues it works',
  }),
  anchors(
    'newest anchor too old',
    'the age of an anchor is judged against the head of its scope, and doctor reads neither the heads nor the ledger sinks',
  ),
  anchors(
    'head below newest anchor',
    'doctor reads neither the heads of the scopes nor the ledger sinks',
  ),
  anchors(
    'sink refused appends',
    'a sink counts its refused appends in the memory of each running process, where doctor cannot read them',
  ),
  personal(
    'fewer than 1,000 distinct values',
    'counting the distinct values of a field needs its unsealed values, which doctor does not read',
    (fields) =>
      fields.some(
        (field) =>
          field.queries.includes('eq') && field.kind !== 'boolean' && field.kind !== 'enum',
      ),
  ),
  personal('index rows and bytes', 'doctor does not read the size of an index', anyField),
  personal(
    'indexes under another Unicode version',
    'the Unicode version of the running processes is not recorded where doctor can read it',
    anyField,
  ),
  personal('failed reindex jobs', 'no record of reindex jobs exists to read', anyField),
  personal('backups with plaintext', 'doctor does not read backups', anyField),
  unfedCheck({
    group: 'health',
    name: 'app.health and app.ready',
    needs: [],
    reason:
      'they are called through a client connection to a running deployment, which doctor does not open',
  }),
];
