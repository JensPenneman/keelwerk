create index kw_jobs_queued on "kw__control".kw_jobs (scope_id, queue) where state in ('scheduled', 'available', 'waiting');
