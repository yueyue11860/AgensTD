insert into public.seasons (code, name, status, starts_at, ends_at, rules)
values (
  'S4',
  'Season 4',
  'active',
  '2026-01-01T00:00:00Z',
  '2026-03-31T23:59:59Z',
  '{"focus":"HELL","realtime":true}'::jsonb
)
on conflict (code) do update
set name = excluded.name,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    rules = excluded.rules;

insert into public.agents (id, slug, name, owner_name, latest_version, status, metadata, last_active_at)
values
  ('11111111-1111-1111-1111-111111111111', 'deepdefender-v3', 'DeepDefender-v3', 'team_alpha', '3.2.1', 'active', '{}'::jsonb, '2026-03-12T14:22:00Z'),
  ('22222222-2222-2222-2222-222222222222', 'neuraltower-x', 'NeuralTower-X', 'lab_omega', '2.0.0', 'training', '{}'::jsonb, '2026-03-12T13:45:00Z'),
  ('33333333-3333-3333-3333-333333333333', 'strategicmind', 'StrategicMind', 'solo_dev', '1.5.3', 'inactive', '{}'::jsonb, '2026-03-11T22:30:00Z'),
  ('44444444-4444-4444-4444-444444444444', 'towermaster-pro', 'TowerMaster-Pro', 'ai_labs', '4.1.0', 'active', '{}'::jsonb, '2026-03-12T15:00:00Z'),
  ('55555555-5555-5555-5555-555555555555', 'defensenet-alpha', 'DefenseNet-Alpha', 'startup_xyz', '1.0.0-beta', 'error', '{}'::jsonb, '2026-03-12T11:20:00Z')
on conflict (id) do update
set slug = excluded.slug,
    name = excluded.name,
    owner_name = excluded.owner_name,
    latest_version = excluded.latest_version,
    status = excluded.status,
    metadata = excluded.metadata,
    last_active_at = excluded.last_active_at;

with active_season as (
  select id from public.seasons where code = 'S4'
)
insert into public.competition_runs (
  id,
  run_code,
  agent_id,
  season_id,
  difficulty,
  seed,
  status,
  start_time,
  end_time,
  duration_ms,
  current_tick,
  max_ticks,
  score,
  wave,
  max_wave,
  resources,
  towers_built,
  enemies_killed,
  damage_dealt,
  damage_taken,
  is_live,
  replay_public,
  view_count
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RUN2026031201', '11111111-1111-1111-1111-111111111111', (select id from active_season), 'HELL', 42857192, 'running', '2026-03-12T14:00:00Z', null, null, 15420, 50000, 38750, 23, 50, '{"gold":1250,"mana":340,"lives":8,"max_lives":10,"energy":75,"max_energy":100}'::jsonb, 18, 1847, 2450000, 125000, true, true, 251),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'RUN2026031202', '44444444-4444-4444-4444-444444444444', (select id from active_season), 'NIGHTMARE', 98712345, 'running', '2026-03-12T13:45:00Z', null, null, 22100, 50000, 52400, 31, 50, '{"gold":2100,"mana":520,"lives":6,"max_lives":8,"energy":45,"max_energy":100}'::jsonb, 24, 2892, 3820000, 280000, true, true, 412),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'RUN2026031203', '22222222-2222-2222-2222-222222222222', (select id from active_season), 'HARD', 55512389, 'completed', '2026-03-12T12:00:00Z', '2026-03-12T12:45:00Z', 2700000, 50000, 50000, 67200, 50, 50, '{"gold":5200,"mana":890,"lives":4,"max_lives":10,"energy":100,"max_energy":100}'::jsonb, 28, 4521, 5920000, 520000, false, true, 860),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'RUN2026031204', '55555555-5555-5555-5555-555555555555', (select id from active_season), 'NORMAL', 11122233, 'failed', '2026-03-12T11:00:00Z', '2026-03-12T11:15:00Z', 900000, 8500, 50000, 8200, 12, 50, '{"gold":0,"mana":0,"lives":0,"max_lives":15,"energy":0,"max_energy":100}'::jsonb, 6, 312, 420000, 380000, false, true, 153),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'RUN2026031205', '33333333-3333-3333-3333-333333333333', (select id from active_season), 'HELL', 77788899, 'queued', null, null, null, 0, 50000, 0, 0, 50, '{"gold":500,"mana":100,"lives":10,"max_lives":10,"energy":100,"max_energy":100}'::jsonb, 0, 0, 0, 0, false, true, 0)
on conflict (id) do nothing;