import { fileURLToPath } from 'node:url';

/** The framework's own repository, whose packages a project made by `init` links instead of installing. */
export const repository = fileURLToPath(new URL('../../../../', import.meta.url));
