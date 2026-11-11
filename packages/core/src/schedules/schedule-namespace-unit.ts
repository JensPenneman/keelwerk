import type { StorageScope } from '../storage/storage-scope.ts';

/** The scope of the ticker's namespace units: the due read, the claims of rows without a tick, the provisioning of groups. */
export const scheduleNamespaceUnit: StorageScope = {
  level: 'namespace',
  reason: 'schedule ticker',
};
