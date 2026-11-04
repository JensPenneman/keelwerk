// Generated from the module's directories (decision 59b); do not edit.
import { defineModule, type ModuleType } from '../../define-module.ts';
import { register as actionsRegister } from './actions/register.ts';
import { accountsBase } from './base.ts';
import { deactivate as entityActionsProfileDeactivate } from './entity-actions/profile/deactivate.ts';
import { search as entityActionsProfileSearch } from './entity-actions/profile/search.ts';
import { operator as policiesProfileOperator } from './policies/profile/operator.ts';
import { open as policiesRegisterOpen } from './policies/register/open.ts';
import { findByEmail as servicesFindByEmail } from './services/find-by-email.ts';

const moduleDef = defineModule(accountsBase, {
  actions: {
    register: actionsRegister,
  },
  services: {
    findByEmail: servicesFindByEmail,
  },
  entityActions: {
    profile: {
      deactivate: entityActionsProfileDeactivate,
      search: entityActionsProfileSearch,
    },
  },
  policies: {
    profile: {
      operator: policiesProfileOperator,
    },
    register: {
      open: policiesRegisterOpen,
    },
  },
});

/** The accounts module. */
export interface Accounts extends ModuleType<typeof moduleDef> {}

/** The accounts module value. */
export const accounts: Accounts = moduleDef;
