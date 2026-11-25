import type { NamespaceRef } from '@keelwerk/core';
import { controlNamespace } from '@keelwerk/core';

/** The namespace of the control root, which the data commands and doctor read the control store through. */
export const controlRootNamespace: NamespaceRef = controlNamespace('control');
