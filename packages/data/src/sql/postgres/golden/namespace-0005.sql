create index kw_jobs_queued on "example".kw_jobs (scope_id, queue) where state in ('scheduled', 'available', 'waiting');
