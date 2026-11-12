const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `text` is a `YYYY-MM-DD` calendar date that exists (no 2026-02-30). The one check of every declared date (section 18.2). */
export function isCalendarDate(text: string): boolean {
  if (!dateFormat.test(text)) {
    return false;
  }
  try {
    return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString() === text;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
