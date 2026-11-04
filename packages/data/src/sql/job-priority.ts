/** `kw_job_lanes.priority` of a job's class (9.5.2): the take serves lower numbers first. */
export function jobPriority(priority: 'high' | 'normal' | 'low' | undefined): number {
  switch (priority) {
    case 'high':
      return 0;
    case 'low':
      return 2;
    case 'normal':
    case undefined:
      return 1;
  }
}
