/** The class a `kw_job_lanes.priority` stands for, the inverse of `jobPriority` (9.5.2). */
export function jobPriorityName(priority: number): 'high' | 'normal' | 'low' {
  return priority <= 0 ? 'high' : priority >= 2 ? 'low' : 'normal';
}
