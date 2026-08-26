create extension if not exists pgcrypto;

create table if not exists public.pvp_modes (
  mode_id text not null check (mode_id in ('ranked_1v1','casual_1v1','custom_1v1')),
  version text not null,
  name text not null,
  team_size integer not null check (team_size >= 1),
  ranked boolean not null,
  reward_scale_bps integer not null check (reward_scale_bps between 0 and 10000),
  ruleset_version text not null,
  map_pool_version text not null,
  enabled boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(mode_id,version)
);

create table if not exists public.pvp_maps (
  map_id text not null,
  version text not null,
  name text not null,
  config_json jsonb not null check (jsonb_typeof(config_json)='object'),
  checksum text not null,
  status text not null check (status in ('draft','active','retired')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(map_id,version)
);

create table if not exists public.pvp_seasons (
  season_id text primary key,
  mode_id text not null,
  mode_version text not null,
  region text not null,
  name text not null,
  status text not null check (status in ('scheduled','active','locked','archived')),
  starts_at timestamptz not null,
  locks_at timestamptz not null,
  ends_at timestamptz not null,
  rank_policy_version text not null,
  reward_policy_version text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (starts_at < locks_at and locks_at <= ends_at),
  foreign key(mode_id,mode_version) references public.pvp_modes(mode_id,version)
);

create unique index if not exists pvp_one_active_season_per_mode_region
  on public.pvp_seasons(mode_id, region) where status = 'active';

create table if not exists public.pvp_matchmaking_tickets (
  ticket_id text primary key,
  request_id text not null unique,
  player_id text not null,
  season_id text not null references public.pvp_seasons(season_id),
  mode_id text not null,
  mode_version text not null,
  region text not null,
  rating_snapshot integer not null check (rating_snapshot >= 0),
  state text not null check (state in ('searching','match_found','accepted','cancelled','expired')),
  enqueued_at timestamptz not null,
  expires_at timestamptz not null,
  matched_match_id text null,
  updated_at timestamptz not null,
  foreign key(mode_id,mode_version) references public.pvp_modes(mode_id,version),
  check (expires_at > enqueued_at)
);

create unique index if not exists pvp_one_active_ticket_per_player_mode
  on public.pvp_matchmaking_tickets(player_id,mode_id) where state in ('searching','match_found','accepted');
create index if not exists pvp_matchmaking_queue_idx
  on public.pvp_matchmaking_tickets(season_id,mode_id,region,state,rating_snapshot,enqueued_at,ticket_id);

create table if not exists public.pvp_ratings (
  season_id text not null references public.pvp_seasons(season_id),
  mode_id text not null,
  mode_version text not null,
  player_id text not null,
  player_name text not null,
  rating integer not null check (rating >= 0),
  league_points integer not null check (league_points >= 0),
  tier text not null check (tier in ('unranked','black_iron','bronze','silver','gold','amethyst','great_sage','victorious_fighting_buddha')),
  division integer null check (division is null or division between 1 and 3),
  provisional_games integer not null check (provisional_games between 0 and 5),
  games integer not null check (games >= 0),
  wins integer not null check (wins >= 0),
  losses integer not null check (losses >= 0),
  draws integer not null check (draws >= 0),
  streak integer not null,
  version bigint not null check (version >= 0),
  tier_reached_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (season_id, mode_id, player_id),
  check (games = wins + losses + draws)
);

create index if not exists pvp_ratings_leaderboard_idx
  on public.pvp_ratings(season_id, mode_id, league_points desc, rating desc, wins desc, tier_reached_at asc, player_id asc)
  where tier <> 'unranked';

create table if not exists public.pvp_matches (
  match_id text primary key,
  season_id text not null references public.pvp_seasons(season_id),
  mode_id text not null,
  mode_version text not null,
  region text not null,
  map_id text not null,
  map_version text not null,
  ruleset_version text not null,
  catalog_version text not null,
  effect_system_version text not null,
  seed text not null,
  status text not null check (status in ('finished','no_contest')),
  integrity_status text not null check (integrity_status in ('valid','invalid','unverified')),
  winner_side text null check (winner_side is null or winner_side in ('A','B')),
  end_reason text not null check (end_reason in ('core_destroyed','surrendered','disconnect_forfeit','simultaneous_draw','hard_timeout','server_void','ruleset_invalid')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms bigint not null check (duration_ms >= 0),
  settlement_status text not null check (settlement_status in ('rating_committed_reward_pending','committed')),
  settlement_request_id text not null unique,
  settlement_fingerprint text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (ended_at >= started_at),
  check ((status = 'no_contest' and winner_side is null) or status = 'finished'),
  foreign key(mode_id,mode_version) references public.pvp_modes(mode_id,version),
  foreign key(map_id,map_version) references public.pvp_maps(map_id,version)
);

create index if not exists pvp_matches_history_idx on public.pvp_matches(ended_at desc, match_id desc);

create table if not exists public.pvp_match_players (
  match_id text not null references public.pvp_matches(match_id) on delete restrict,
  player_id text not null,
  player_name text not null,
  side text not null check (side in ('A','B')),
  slot integer not null check (slot >= 0),
  outcome text not null check (outcome in ('win','loss','draw','no_contest')),
  loadout_snapshot_id text not null,
  rating_before integer not null,
  rating_delta integer not null,
  rating_after integer not null,
  league_points_before integer not null,
  league_points_delta integer not null,
  league_points_after integer not null,
  tier_before text not null,
  tier_after text not null,
  disconnected_ms bigint not null check (disconnected_ms >= 0),
  forfeited boolean not null,
  stats_json jsonb not null default '{}'::jsonb check (jsonb_typeof(stats_json) = 'object'),
  primary key (match_id, player_id),
  unique (match_id, side, slot)
);

create index if not exists pvp_match_players_history_idx on public.pvp_match_players(player_id, match_id);

create table if not exists public.pvp_settlements (
  settlement_id text primary key,
  match_id text not null references public.pvp_matches(match_id),
  player_id text not null,
  request_id text not null unique,
  fingerprint text not null,
  outcome text not null check (outcome in ('win','loss','draw','no_contest')),
  rating_before integer not null,
  rating_delta integer not null,
  rating_after integer not null,
  league_points_before integer not null,
  league_points_delta integer not null,
  league_points_after integer not null,
  tier_before text not null,
  tier_after text not null,
  reward_json jsonb not null default '{}'::jsonb check (jsonb_typeof(reward_json) = 'object'),
  reward_status text not null check (reward_status in ('not_applicable','pending','processing','committed','failed')),
  committed_at timestamptz not null,
  unique (match_id, player_id)
);

create table if not exists public.pvp_rating_ledger (
  ledger_id text primary key,
  season_id text not null,
  mode_id text not null,
  match_id text not null references public.pvp_matches(match_id),
  player_id text not null,
  rating_before integer not null,
  rating_delta integer not null,
  rating_after integer not null,
  league_points_before integer not null,
  league_points_delta integer not null,
  league_points_after integer not null,
  policy_version text not null,
  created_at timestamptz not null,
  unique (match_id, player_id)
);

create index if not exists pvp_rating_ledger_player_idx
  on public.pvp_rating_ledger(player_id, season_id, mode_id, created_at desc, ledger_id desc);

create table if not exists public.pvp_reward_outbox (
  event_id text primary key,
  match_id text not null references public.pvp_matches(match_id),
  player_id text not null,
  event_type text not null check (event_type = 'pvp_match_reward'),
  payload_json jsonb not null check (jsonb_typeof(payload_json) = 'object'),
  status text not null check (status in ('pending','processing','committed','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null,
  lease_owner text null,
  lease_expires_at timestamptz null,
  last_error text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (match_id, player_id)
);

create index if not exists pvp_reward_outbox_claim_idx
  on public.pvp_reward_outbox(status, available_at, event_id);

create table if not exists public.pvp_replay_manifests (
  match_id text primary key,
  ruleset_version text not null,
  catalog_version text not null,
  effect_system_version text not null,
  map_id text not null,
  map_version text not null,
  seed text not null,
  initial_snapshot_json jsonb null,
  initial_snapshot_uri text null,
  action_count integer not null default 0 check (action_count >= 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  final_state_hash text null,
  visibility text not null check (visibility in ('participants','public_delayed','public')),
  status text not null check (status in ('recording','complete','invalid')),
  manifest_fingerprint text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((initial_snapshot_json is null) <> (initial_snapshot_uri is null))
);

create table if not exists public.pvp_replay_chunks (
  match_id text not null references public.pvp_replay_manifests(match_id),
  chunk_index integer not null check (chunk_index >= 0),
  first_tick integer not null check (first_tick >= 0),
  last_tick integer not null check (last_tick >= first_tick),
  payload_json jsonb null,
  object_uri text null,
  sha256 text not null,
  created_at timestamptz not null,
  primary key (match_id, chunk_index),
  check ((payload_json is null) <> (object_uri is null))
);

alter table public.pvp_seasons enable row level security;
alter table public.pvp_modes enable row level security;
alter table public.pvp_maps enable row level security;
alter table public.pvp_matchmaking_tickets enable row level security;
alter table public.pvp_ratings enable row level security;
alter table public.pvp_matches enable row level security;
alter table public.pvp_match_players enable row level security;
alter table public.pvp_settlements enable row level security;
alter table public.pvp_rating_ledger enable row level security;
alter table public.pvp_reward_outbox enable row level security;
alter table public.pvp_replay_manifests enable row level security;
alter table public.pvp_replay_chunks enable row level security;

-- 竞技原始表仅由 service_role 访问；公开榜单必须经过脱敏 API/View。
revoke all on public.pvp_modes, public.pvp_maps, public.pvp_matchmaking_tickets,
  public.pvp_seasons, public.pvp_ratings, public.pvp_matches,
  public.pvp_match_players, public.pvp_settlements, public.pvp_rating_ledger,
  public.pvp_reward_outbox, public.pvp_replay_manifests, public.pvp_replay_chunks
  from public, anon, authenticated;
grant select,insert,update on public.pvp_modes, public.pvp_maps, public.pvp_matchmaking_tickets,
  public.pvp_seasons, public.pvp_ratings, public.pvp_matches,
  public.pvp_match_players, public.pvp_settlements, public.pvp_rating_ledger,
  public.pvp_reward_outbox, public.pvp_replay_manifests, public.pvp_replay_chunks
  to service_role;

create or replace function public.commit_pvp_match_settlement(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb := p_command -> 'match';
  players jsonb := p_command -> 'players';
  p jsonb;
  existing_fingerprint text;
  existing_request_match text;
  current_version bigint;
  expected_version bigint;
  rated boolean;
begin
  if jsonb_typeof(m) <> 'object' or jsonb_typeof(players) <> 'array' or jsonb_array_length(players) <> 2 then
    raise exception 'INVALID_PVP_SETTLEMENT_COMMAND';
  end if;

  select settlement_fingerprint into existing_fingerprint from public.pvp_matches where match_id = m ->> 'matchId';
  if found then
    if existing_fingerprint = m ->> 'settlementFingerprint' then
      return jsonb_build_object('status', 'duplicate');
    end if;
    raise exception 'PVP_SETTLEMENT_CONFLICT';
  end if;

  select match_id into existing_request_match from public.pvp_matches where settlement_request_id = m ->> 'settlementRequestId';
  if found then raise exception 'PVP_SETTLEMENT_REQUEST_CONFLICT'; end if;

  -- 按 playerId 稳定顺序加事务级锁，避免两场同时结算产生死锁或双边部分改分。
  for p in select value from jsonb_array_elements(players) order by value -> 'participant' ->> 'playerId'
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      (m ->> 'seasonId') || E'\x1f' || (m ->> 'modeId') || E'\x1f' || (p -> 'participant' ->> 'playerId'), 0
    ));
  end loop;

  for p in select value from jsonb_array_elements(players)
  loop
    expected_version := (p ->> 'expectedRatingVersion')::bigint;
    select version into current_version
      from public.pvp_ratings
      where season_id = m ->> 'seasonId' and mode_id = m ->> 'modeId'
        and player_id = p -> 'participant' ->> 'playerId'
      for update;
    current_version := coalesce(current_version, 0);
    if current_version <> expected_version then
      return jsonb_build_object('status', 'rating_conflict');
    end if;
  end loop;

  insert into public.pvp_matches (
    match_id,season_id,mode_id,mode_version,region,map_id,map_version,ruleset_version,catalog_version,effect_system_version,
    seed,status,integrity_status,winner_side,end_reason,started_at,ended_at,duration_ms,settlement_status,
    settlement_request_id,settlement_fingerprint,created_at,updated_at
  ) values (
    m->>'matchId', m->>'seasonId', m->>'modeId',m->>'modeVersion', m->>'region', m->>'mapId', m->>'mapVersion',
    m->>'rulesetVersion', m->>'catalogVersion', m->>'effectSystemVersion', m->>'seed', m->>'status',
    m->>'integrityStatus', nullif(m->>'winnerSide',''), m->>'endReason', (m->>'startedAt')::timestamptz,
    (m->>'endedAt')::timestamptz, (m->>'durationMs')::bigint, m->>'settlementStatus',
    m->>'settlementRequestId', m->>'settlementFingerprint', (m->>'createdAt')::timestamptz, (m->>'updatedAt')::timestamptz
  );

  for p in select value from jsonb_array_elements(players)
  loop
    insert into public.pvp_match_players (
      match_id,player_id,player_name,side,slot,outcome,loadout_snapshot_id,rating_before,rating_delta,rating_after,
      league_points_before,league_points_delta,league_points_after,tier_before,tier_after,disconnected_ms,forfeited,stats_json
    ) values (
      m->>'matchId', p->'participant'->>'playerId', p->'participant'->>'playerName',
      p->'participant'->>'side', (p->'participant'->>'slot')::integer, p->'participant'->>'outcome',
      p->'participant'->>'loadoutSnapshotId', (p->'participant'->>'ratingBefore')::integer,
      (p->'participant'->>'ratingDelta')::integer, (p->'participant'->>'ratingAfter')::integer,
      (p->'participant'->>'leaguePointsBefore')::integer, (p->'participant'->>'leaguePointsDelta')::integer,
      (p->'participant'->>'leaguePointsAfter')::integer, p->'participant'->>'tierBefore',
      p->'participant'->>'tierAfter', (p->'participant'->>'disconnectedMs')::bigint,
      (p->'participant'->>'forfeited')::boolean, p->'participant'->'stats'
    );

    insert into public.pvp_settlements (
      settlement_id,match_id,player_id,request_id,fingerprint,outcome,rating_before,rating_delta,rating_after,
      league_points_before,league_points_delta,league_points_after,tier_before,tier_after,reward_json,reward_status,committed_at
    ) values (
      p->'settlement'->>'settlementId', m->>'matchId', p->'settlement'->>'playerId',
      p->'settlement'->>'requestId', p->'settlement'->>'fingerprint', p->'settlement'->>'outcome',
      (p->'settlement'->>'ratingBefore')::integer, (p->'settlement'->>'ratingDelta')::integer,
      (p->'settlement'->>'ratingAfter')::integer, (p->'settlement'->>'leaguePointsBefore')::integer,
      (p->'settlement'->>'leaguePointsDelta')::integer, (p->'settlement'->>'leaguePointsAfter')::integer,
      p->'settlement'->>'tierBefore', p->'settlement'->>'tierAfter', p->'settlement'->'reward',
      p->'settlement'->>'rewardStatus', (p->'settlement'->>'committedAt')::timestamptz
    );

    rated := jsonb_typeof(p->'ledger') = 'object';
    if rated then
      insert into public.pvp_ratings (
        season_id,mode_id,player_id,player_name,rating,league_points,tier,division,provisional_games,games,wins,losses,
        draws,streak,version,tier_reached_at,updated_at
      ) values (
        p->'nextRating'->>'seasonId', p->'nextRating'->>'modeId', p->'nextRating'->>'playerId',
        p->'participant'->>'playerName', (p->'nextRating'->>'rating')::integer,
        (p->'nextRating'->>'leaguePoints')::integer, p->'nextRating'->>'tier',
        nullif(p->'nextRating'->>'division','')::integer, (p->'nextRating'->>'provisionalGames')::integer,
        (p->'nextRating'->>'games')::integer, (p->'nextRating'->>'wins')::integer,
        (p->'nextRating'->>'losses')::integer, (p->'nextRating'->>'draws')::integer,
        (p->'nextRating'->>'streak')::integer, (p->'nextRating'->>'version')::bigint,
        (p->'nextRating'->>'tierReachedAt')::timestamptz, (p->'nextRating'->>'updatedAt')::timestamptz
      ) on conflict (season_id, mode_id, player_id) do update set
        player_name=excluded.player_name, rating=excluded.rating, league_points=excluded.league_points,
        tier=excluded.tier, division=excluded.division, provisional_games=excluded.provisional_games,
        games=excluded.games, wins=excluded.wins, losses=excluded.losses, draws=excluded.draws,
        streak=excluded.streak, version=excluded.version, tier_reached_at=excluded.tier_reached_at,
        updated_at=excluded.updated_at;

      insert into public.pvp_rating_ledger (
        ledger_id,season_id,mode_id,match_id,player_id,rating_before,rating_delta,rating_after,league_points_before,
        league_points_delta,league_points_after,policy_version,created_at
      ) values (
        p->'ledger'->>'ledgerId', p->'ledger'->>'seasonId', p->'ledger'->>'modeId',
        p->'ledger'->>'matchId', p->'ledger'->>'playerId', (p->'ledger'->>'ratingBefore')::integer,
        (p->'ledger'->>'ratingDelta')::integer, (p->'ledger'->>'ratingAfter')::integer,
        (p->'ledger'->>'leaguePointsBefore')::integer, (p->'ledger'->>'leaguePointsDelta')::integer,
        (p->'ledger'->>'leaguePointsAfter')::integer, p->'ledger'->>'policyVersion',
        (p->'ledger'->>'createdAt')::timestamptz
      );
    end if;

    if jsonb_typeof(p->'outbox') = 'object' then
      insert into public.pvp_reward_outbox (
        event_id,match_id,player_id,event_type,payload_json,status,attempts,available_at,lease_owner,lease_expires_at,
        last_error,created_at,updated_at
      ) values (
        p->'outbox'->>'eventId', p->'outbox'->>'matchId', p->'outbox'->>'playerId',
        p->'outbox'->>'eventType', p->'outbox'->'payload', p->'outbox'->>'status',
        (p->'outbox'->>'attempts')::integer, (p->'outbox'->>'availableAt')::timestamptz,
        nullif(p->'outbox'->>'leaseOwner',''), nullif(p->'outbox'->>'leaseExpiresAt','')::timestamptz,
        nullif(p->'outbox'->>'lastError',''), (p->'outbox'->>'createdAt')::timestamptz,
        (p->'outbox'->>'updatedAt')::timestamptz
      );
    end if;
  end loop;

  return jsonb_build_object('status', 'committed');
end;
$$;

create or replace function public.claim_pvp_reward_outbox(p_worker_id text, p_limit integer, p_now timestamptz, p_lease_ms integer)
returns setof public.pvp_reward_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select event_id from public.pvp_reward_outbox
    where (status='pending' and available_at <= p_now)
       or (status='processing' and lease_expires_at <= p_now)
    order by available_at, event_id
    for update skip locked
    limit greatest(1, least(100, p_limit))
  ), updated as (
    update public.pvp_reward_outbox o set status='processing', attempts=o.attempts+1,
      lease_owner=p_worker_id, lease_expires_at=p_now + make_interval(secs => greatest(1,p_lease_ms)::double precision/1000),
      updated_at=p_now
    from candidates c where o.event_id=c.event_id returning o.*
  ) select * from updated;
end;
$$;

create or replace function public.complete_pvp_reward_outbox(p_event_id text, p_worker_id text, p_completed_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare affected integer; v_match text; v_player text;
begin
  update public.pvp_reward_outbox set status='committed', lease_owner=null, lease_expires_at=null,
    last_error=null, updated_at=p_completed_at
  where event_id=p_event_id and status='processing' and lease_owner=p_worker_id
  returning match_id,player_id into v_match,v_player;
  get diagnostics affected=row_count; if affected<>1 then return false; end if;
  update public.pvp_settlements set reward_status='committed' where match_id=v_match and player_id=v_player;
  if not exists(select 1 from public.pvp_settlements where match_id=v_match and reward_status not in ('committed','not_applicable')) then
    update public.pvp_matches set settlement_status='committed',updated_at=p_completed_at where match_id=v_match;
  end if;
  return true;
end; $$;

create or replace function public.fail_pvp_reward_outbox(p_event_id text,p_worker_id text,p_error text,p_retry_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare affected integer; v_match text; v_player text;
begin
  update public.pvp_reward_outbox set status='pending',available_at=p_retry_at,lease_owner=null,
    lease_expires_at=null,last_error=left(p_error,1000),updated_at=p_retry_at
  where event_id=p_event_id and status='processing' and lease_owner=p_worker_id
  returning match_id,player_id into v_match,v_player;
  get diagnostics affected=row_count; if affected<>1 then return false; end if;
  update public.pvp_settlements set reward_status='pending' where match_id=v_match and player_id=v_player;
  return true;
end; $$;

create or replace function public.transition_pvp_matchmaking_ticket(
  p_ticket_id text,p_expected_state text,p_next_state text,p_matched_match_id text,p_updated_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  if p_expected_state not in ('searching','match_found','accepted','cancelled','expired')
    or p_next_state not in ('searching','match_found','accepted','cancelled','expired') then return false; end if;
  update public.pvp_matchmaking_tickets set state=p_next_state,
    matched_match_id=coalesce(p_matched_match_id,matched_match_id),updated_at=p_updated_at
  where ticket_id=p_ticket_id and state=p_expected_state;
  get diagnostics affected=row_count;
  return affected=1;
end; $$;

create or replace function public.append_pvp_replay_chunk(p_chunk jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.pvp_replay_manifests%rowtype; existing_sha text;
begin
  select * into m from public.pvp_replay_manifests where match_id=p_chunk->>'matchId' for update;
  if not found then raise exception 'PVP_REPLAY_NOT_FOUND'; end if;
  select sha256 into existing_sha from public.pvp_replay_chunks where match_id=m.match_id and chunk_index=(p_chunk->>'chunkIndex')::integer;
  if found then
    if existing_sha=p_chunk->>'sha256' then return jsonb_build_object('status','duplicate'); end if;
    raise exception 'PVP_REPLAY_CHUNK_CONFLICT';
  end if;
  if m.status<>'recording' or (p_chunk->>'chunkIndex')::integer<>m.chunk_count then raise exception 'PVP_REPLAY_CHUNK_ORDER'; end if;
  insert into public.pvp_replay_chunks (
    match_id,chunk_index,first_tick,last_tick,payload_json,object_uri,sha256,created_at
  ) values (
    p_chunk->>'matchId',(p_chunk->>'chunkIndex')::integer,(p_chunk->>'firstTick')::integer,
    (p_chunk->>'lastTick')::integer,
    case when jsonb_typeof(p_chunk->'payload')='object' then p_chunk->'payload' else null end,
    nullif(p_chunk->>'objectUri',''),p_chunk->>'sha256',
    (p_chunk->>'createdAt')::timestamptz
  );
  update public.pvp_replay_manifests set chunk_count=chunk_count+1,updated_at=(p_chunk->>'createdAt')::timestamptz where match_id=m.match_id;
  return jsonb_build_object('status','committed');
end; $$;

create or replace function public.finalize_pvp_replay(p_match_id text,p_chunk_count integer,p_action_count integer,p_final_hash text,p_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare m public.pvp_replay_manifests%rowtype;
begin
  select * into m from public.pvp_replay_manifests where match_id=p_match_id for update;
  if not found then raise exception 'PVP_REPLAY_NOT_FOUND'; end if;
  if m.status='complete' then return m.chunk_count=p_chunk_count and m.action_count=p_action_count and m.final_state_hash=p_final_hash; end if;
  if m.status<>'recording' or m.chunk_count<>p_chunk_count or p_final_hash='' or
    (select count(*) from public.pvp_replay_chunks where match_id=p_match_id)<>p_chunk_count then return false; end if;
  update public.pvp_replay_manifests set status='complete',action_count=p_action_count,
    final_state_hash=p_final_hash,updated_at=p_updated_at where match_id=p_match_id;
  return true;
end; $$;

create or replace function public.get_pvp_leaderboard_page(
  p_season_id text,p_mode_id text,p_limit integer,
  p_cursor_lp integer default null,p_cursor_rating integer default null,p_cursor_wins integer default null,
  p_cursor_reached_at timestamptz default null,p_cursor_player_id text default null
) returns table (
  rank bigint, season_id text, mode_id text, player_id text, player_name text, rating integer,
  league_points integer, tier text, division integer, provisional_games integer, games integer,
  wins integer, losses integer, draws integer, streak integer, version bigint,
  tier_reached_at timestamptz, updated_at timestamptz
) language sql stable security definer set search_path=public as $$
  with ranked as (
    select row_number() over(order by r.league_points desc,r.rating desc,r.wins desc,r.tier_reached_at asc,r.player_id asc) as rank,
      r.* from public.pvp_ratings r
    where r.season_id=p_season_id and r.mode_id=p_mode_id and r.tier<>'unranked'
  )
  select r.rank,r.season_id,r.mode_id,r.player_id,r.player_name,r.rating,r.league_points,
    case when r.rank<=500 and r.league_points>=1800 then 'victorious_fighting_buddha' else r.tier end,
    case when r.rank<=500 and r.league_points>=1800 then null else r.division end,
    r.provisional_games,r.games,r.wins,r.losses,r.draws,r.streak,r.version,r.tier_reached_at,r.updated_at
  from ranked r
  where p_cursor_player_id is null
     or r.league_points < p_cursor_lp
     or (r.league_points=p_cursor_lp and r.rating < p_cursor_rating)
     or (r.league_points=p_cursor_lp and r.rating=p_cursor_rating and r.wins < p_cursor_wins)
     or (r.league_points=p_cursor_lp and r.rating=p_cursor_rating and r.wins=p_cursor_wins and r.tier_reached_at > p_cursor_reached_at)
     or (r.league_points=p_cursor_lp and r.rating=p_cursor_rating and r.wins=p_cursor_wins and r.tier_reached_at=p_cursor_reached_at and r.player_id > p_cursor_player_id)
  order by r.league_points desc,r.rating desc,r.wins desc,r.tier_reached_at asc,r.player_id asc
  limit greatest(1,least(101,p_limit));
$$;

create or replace function public.list_pvp_match_history_ids(
  p_player_id text,p_season_id text default null,p_mode_id text default null,p_limit integer default 20,
  p_cursor_ended_at timestamptz default null,p_cursor_match_id text default null
) returns table(match_id text,ended_at timestamptz)
language sql stable security definer set search_path=public as $$
  select m.match_id,m.ended_at from public.pvp_matches m
  join public.pvp_match_players p on p.match_id=m.match_id
  where p.player_id=p_player_id
    and (p_season_id is null or m.season_id=p_season_id)
    and (p_mode_id is null or m.mode_id=p_mode_id)
    and (p_cursor_match_id is null or m.ended_at<p_cursor_ended_at or (m.ended_at=p_cursor_ended_at and m.match_id<p_cursor_match_id))
  order by m.ended_at desc,m.match_id desc limit greatest(1,least(101,p_limit));
$$;

revoke all on function public.commit_pvp_match_settlement(jsonb) from public,anon,authenticated;
revoke all on function public.claim_pvp_reward_outbox(text,integer,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.complete_pvp_reward_outbox(text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.fail_pvp_reward_outbox(text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.transition_pvp_matchmaking_ticket(text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.append_pvp_replay_chunk(jsonb) from public,anon,authenticated;
revoke all on function public.finalize_pvp_replay(text,integer,integer,text,timestamptz) from public,anon,authenticated;
revoke all on function public.get_pvp_leaderboard_page(text,text,integer,integer,integer,integer,timestamptz,text) from public,anon,authenticated;
revoke all on function public.list_pvp_match_history_ids(text,text,text,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function public.commit_pvp_match_settlement(jsonb) to service_role;
grant execute on function public.claim_pvp_reward_outbox(text,integer,timestamptz,integer) to service_role;
grant execute on function public.complete_pvp_reward_outbox(text,text,timestamptz) to service_role;
grant execute on function public.fail_pvp_reward_outbox(text,text,text,timestamptz) to service_role;
grant execute on function public.transition_pvp_matchmaking_ticket(text,text,text,text,timestamptz) to service_role;
grant execute on function public.append_pvp_replay_chunk(jsonb) to service_role;
grant execute on function public.finalize_pvp_replay(text,integer,integer,text,timestamptz) to service_role;
grant execute on function public.get_pvp_leaderboard_page(text,text,integer,integer,integer,integer,timestamptz,text) to service_role;
grant execute on function public.list_pvp_match_history_ids(text,text,text,integer,timestamptz,text) to service_role;
