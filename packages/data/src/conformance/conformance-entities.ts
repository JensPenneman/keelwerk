import { conformanceAccount } from './conformance-account.ts';
import { conformanceCredential } from './conformance-credential.ts';
import type { ConformanceEntitySet } from './conformance-entity-set.ts';
import { conformanceKitchen } from './conformance-kitchen.ts';
import { conformanceNetwork } from './conformance-network.ts';
import { conformanceOwner } from './conformance-owner.ts';
import { conformancePerson } from './conformance-person.ts';
import { conformanceProbe } from './conformance-probe.ts';
import { conformanceSetting } from './conformance-setting.ts';
import { conformanceTicket } from './conformance-ticket.ts';

/**
 * Descriptors that cover every field kind (14.10): plain kinds and collections on `kitchen`,
 * sealed kinds on `credential`, the serial on `ticket`, unique constraints on `account`, the
 * quantifier relations between `owner` and `probe`, and one entity per tenancy level, and personal fields under every normaliser on `person`.
 */
export const conformanceEntities: ConformanceEntitySet = {
  kitchen: conformanceKitchen,
  owner: conformanceOwner,
  probe: conformanceProbe,
  credential: conformanceCredential,
  ticket: conformanceTicket,
  account: conformanceAccount,
  setting: conformanceSetting,
  network: conformanceNetwork,
  person: conformancePerson,
};
