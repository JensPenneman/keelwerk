import { library } from '../../../modules/library/src/module.generated.ts';
import { loans } from '../../../modules/loans/src/module.generated.ts';

export const modules = [library, loans] as const;
