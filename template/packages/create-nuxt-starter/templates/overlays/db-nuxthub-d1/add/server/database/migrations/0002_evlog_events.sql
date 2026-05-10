CREATE TABLE IF NOT EXISTS evlog_events (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,
  service TEXT,
  status TEXT,
  request_id TEXT,
  event_name TEXT,
  message TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS evlog_events_timestamp_idx ON evlog_events(timestamp);
CREATE INDEX IF NOT EXISTS evlog_events_level_idx ON evlog_events(level);
CREATE INDEX IF NOT EXISTS evlog_events_service_idx ON evlog_events(service);
CREATE INDEX IF NOT EXISTS evlog_events_status_idx ON evlog_events(status);
CREATE INDEX IF NOT EXISTS evlog_events_request_id_idx ON evlog_events(request_id);
CREATE INDEX IF NOT EXISTS evlog_events_created_at_idx ON evlog_events(created_at);
