import { defineCondition } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';

/** The parts the module adds when accounts is selected: it reacts to a profile's deactivation (5.4). */
export const whenAccounts = defineCondition([accounts], {});
