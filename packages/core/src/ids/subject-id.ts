declare const subjectBrand: unique symbol;

/** An opaque principal or data-subject id (section 8.5). */
export type SubjectId = string & { readonly [subjectBrand]: true };
