CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  queue_stopped INTEGER NOT NULL CHECK(queue_stopped IN (0,1)),
  CHECK(json_extract(data_json, '$.id') = id)
) STRICT;
CREATE TABLE task_groups (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id TEXT,
  name TEXT,
  group_type TEXT NOT NULL CHECK(group_type IN ('single','workflow','episode-seconds','episode-film')),
  action TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('panel','session')),
  shot_ids_json TEXT NOT NULL CHECK(json_valid(shot_ids_json)),
  created_at TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE(project_id,id)
) STRICT;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  group_seq INTEGER NOT NULL CHECK(group_seq >= 1),
  name TEXT,
  business_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  episode_id TEXT,
  action TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('panel','session')),
  task_status TEXT NOT NULL CHECK(task_status IN ('queued','running','completed','rejected','failed','cancelled','superseded')),
  queue_order INTEGER NOT NULL CHECK(queue_order >= 1),
  opinion TEXT NOT NULL,
  previous_node_state_json TEXT NOT NULL CHECK(json_valid(previous_node_state_json)),
  end_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  position INTEGER NOT NULL,
  UNIQUE(project_id,id),
  UNIQUE(group_id,group_seq),
  FOREIGN KEY(project_id,group_id) REFERENCES task_groups(project_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE task_steps (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq >= 1),
  name TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('precheck','generate','review','revise','manual_edit','override','impact','apply')),
  round INTEGER NOT NULL CHECK(round BETWEEN 0 AND 2),
  step_status TEXT NOT NULL CHECK(step_status IN ('ready','running','done','rejected','failed','skipped','cancelled','superseded')),
  prompt_json TEXT NOT NULL CHECK(json_valid(prompt_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  error_reason TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  position INTEGER NOT NULL,
  UNIQUE(task_id,seq),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE command_requests (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  position INTEGER NOT NULL,
  PRIMARY KEY(project_id,id)
) STRICT;
CREATE TABLE notification_outbox (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  position INTEGER NOT NULL,
  PRIMARY KEY(project_id,id)
) STRICT;
CREATE INDEX group_history ON task_groups(project_id,created_at DESC,id);
CREATE INDEX task_queue ON tasks(project_id,task_status,queue_order);
CREATE UNIQUE INDEX one_running_task ON tasks(project_id) WHERE task_status='running';
CREATE INDEX steps_project ON task_steps(project_id);
INSERT INTO schema_migrations VALUES (1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES (2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES (3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES (4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations VALUES (5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
PRAGMA user_version=5;
