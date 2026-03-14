// Mock Data for Roguelike Tower Defense AI Competition Platform

export interface Agent {
  id: string
  name: string
  version: string
  owner: string
  created_at: string
  last_active: string
  total_runs: number
  win_rate: number
  avg_score: number
  status: 'active' | 'inactive' | 'training' | 'error'
  avatar?: string
}

export interface Run {
  run_id: string
  agent_id: string
  agent_name: string
  difficulty: 'NORMAL' | 'HARD' | 'HELL' | 'NIGHTMARE' | 'INFERNO'
  seed: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout'
  start_time: string
  end_time?: string
  duration_ms?: number
  current_tick: number
  max_ticks: number
  score: number
  wave: number
  max_wave: number
  resources: Resources
  towers_built: number
  enemies_killed: number
  damage_dealt: number
  damage_taken: number
  is_live: boolean
}

export interface Resources {
  gold: number
  mana: number
  lives: number
  max_lives: number
  energy: number
  max_energy: number
}

export interface Tower {
  id: string
  type: 'CANNON' | 'LASER' | 'FROST' | 'TESLA' | 'MISSILE' | 'FLAME'
  level: number
  position: { x: number; y: number }
  kills: number
  damage_dealt: number
  upgrades: number
  status: 'active' | 'charging' | 'overheated' | 'disabled'
}

export interface Enemy {
  id: string
  type: 'GRUNT' | 'TANK' | 'SWIFT' | 'HEALER' | 'BOSS' | 'ELITE'
  health: number
  max_health: number
  position: { x: number; y: number }
  speed: number
  armor: number
  status: 'moving' | 'attacking' | 'stunned' | 'dead'
}

export interface ReplaySnapshot {
  tick: number
  timestamp: string
  game_state: {
    resources: Resources
    towers: Tower[]
    enemies: Enemy[]
    wave: number
    score: number
  }
  thumbnail?: string
}

export interface SeasonRanking {
  rank: number
  agent_id: string
  agent_name: string
  owner: string
  score: number
  wins: number
  losses: number
  win_rate: number
  avg_duration_ms: number
  highest_wave: number
  difficulty_cleared: string[]
  last_match: string
  trend: 'up' | 'down' | 'stable'
  rank_change: number
}

export interface DifficultyProgress {
  difficulty: string
  unlocked: boolean
  cleared: boolean
  best_score: number
  best_wave: number
  attempts: number
  clear_rate: number
  requirements: string[]
}

// Mock Agents
export const mockAgents: Agent[] = [
  {
    id: 'agent_001',
    name: 'DeepDefender-v3',
    version: '3.2.1',
    owner: 'team_alpha',
    created_at: '2024-01-15T08:30:00Z',
    last_active: '2024-03-12T14:22:00Z',
    total_runs: 1247,
    win_rate: 0.73,
    avg_score: 45620,
    status: 'active'
  },
  {
    id: 'agent_002',
    name: 'NeuralTower-X',
    version: '2.0.0',
    owner: 'lab_omega',
    created_at: '2024-02-01T12:00:00Z',
    last_active: '2024-03-12T13:45:00Z',
    total_runs: 892,
    win_rate: 0.68,
    avg_score: 42150,
    status: 'training'
  },
  {
    id: 'agent_003',
    name: 'StrategicMind',
    version: '1.5.3',
    owner: 'solo_dev',
    created_at: '2024-02-20T09:15:00Z',
    last_active: '2024-03-11T22:30:00Z',
    total_runs: 456,
    win_rate: 0.52,
    avg_score: 31200,
    status: 'inactive'
  },
  {
    id: 'agent_004',
    name: 'TowerMaster-Pro',
    version: '4.1.0',
    owner: 'ai_labs',
    created_at: '2024-01-05T16:00:00Z',
    last_active: '2024-03-12T15:00:00Z',
    total_runs: 2341,
    win_rate: 0.81,
    avg_score: 52300,
    status: 'active'
  },
  {
    id: 'agent_005',
    name: 'DefenseNet-Alpha',
    version: '1.0.0-beta',
    owner: 'startup_xyz',
    created_at: '2024-03-01T10:00:00Z',
    last_active: '2024-03-12T11:20:00Z',
    total_runs: 89,
    win_rate: 0.35,
    avg_score: 18500,
    status: 'error'
  }
]

// Mock Runs
export const mockRuns: Run[] = [
  {
    run_id: 'run_20240312_001',
    agent_id: 'agent_001',
    agent_name: 'DeepDefender-v3',
    difficulty: 'HELL',
    seed: 42857192,
    status: 'running',
    start_time: '2024-03-12T14:00:00Z',
    current_tick: 15420,
    max_ticks: 50000,
    score: 38750,
    wave: 23,
    max_wave: 50,
    resources: { gold: 1250, mana: 340, lives: 8, max_lives: 10, energy: 75, max_energy: 100 },
    towers_built: 18,
    enemies_killed: 1847,
    damage_dealt: 2450000,
    damage_taken: 125000,
    is_live: true
  },
  {
    run_id: 'run_20240312_002',
    agent_id: 'agent_004',
    agent_name: 'TowerMaster-Pro',
    difficulty: 'NIGHTMARE',
    seed: 98712345,
    status: 'running',
    start_time: '2024-03-12T13:45:00Z',
    current_tick: 22100,
    max_ticks: 50000,
    score: 52400,
    wave: 31,
    max_wave: 50,
    resources: { gold: 2100, mana: 520, lives: 6, max_lives: 8, energy: 45, max_energy: 100 },
    towers_built: 24,
    enemies_killed: 2892,
    damage_dealt: 3820000,
    damage_taken: 280000,
    is_live: true
  },
  {
    run_id: 'run_20240312_003',
    agent_id: 'agent_002',
    agent_name: 'NeuralTower-X',
    difficulty: 'HARD',
    seed: 55512389,
    status: 'completed',
    start_time: '2024-03-12T12:00:00Z',
    end_time: '2024-03-12T12:45:00Z',
    duration_ms: 2700000,
    current_tick: 50000,
    max_ticks: 50000,
    score: 67200,
    wave: 50,
    max_wave: 50,
    resources: { gold: 5200, mana: 890, lives: 4, max_lives: 10, energy: 100, max_energy: 100 },
    towers_built: 28,
    enemies_killed: 4521,
    damage_dealt: 5920000,
    damage_taken: 520000,
    is_live: false
  },
  {
    run_id: 'run_20240312_004',
    agent_id: 'agent_005',
    agent_name: 'DefenseNet-Alpha',
    difficulty: 'NORMAL',
    seed: 11122233,
    status: 'failed',
    start_time: '2024-03-12T11:00:00Z',
    end_time: '2024-03-12T11:15:00Z',
    duration_ms: 900000,
    current_tick: 8500,
    max_ticks: 50000,
    score: 8200,
    wave: 12,
    max_wave: 50,
    resources: { gold: 0, mana: 0, lives: 0, max_lives: 15, energy: 0, max_energy: 100 },
    towers_built: 6,
    enemies_killed: 312,
    damage_dealt: 420000,
    damage_taken: 380000,
    is_live: false
  },
  {
    run_id: 'run_20240312_005',
    agent_id: 'agent_003',
    agent_name: 'StrategicMind',
    difficulty: 'HELL',
    seed: 77788899,
    status: 'queued',
    start_time: '2024-03-12T15:30:00Z',
    current_tick: 0,
    max_ticks: 50000,
    score: 0,
    wave: 0,
    max_wave: 50,
    resources: { gold: 500, mana: 100, lives: 10, max_lives: 10, energy: 100, max_energy: 100 },
    towers_built: 0,
    enemies_killed: 0,
    damage_dealt: 0,
    damage_taken: 0,
    is_live: false
  }
]

// Mock Replay Snapshots
export const mockSnapshots: ReplaySnapshot[] = [
  { tick: 0, timestamp: '2024-03-12T14:00:00Z', game_state: { resources: { gold: 500, mana: 100, lives: 10, max_lives: 10, energy: 100, max_energy: 100 }, towers: [], enemies: [], wave: 0, score: 0 } },
  { tick: 5000, timestamp: '2024-03-12T14:05:00Z', game_state: { resources: { gold: 850, mana: 180, lives: 10, max_lives: 10, energy: 85, max_energy: 100 }, towers: [], enemies: [], wave: 5, score: 4200 } },
  { tick: 10000, timestamp: '2024-03-12T14:10:00Z', game_state: { resources: { gold: 1100, mana: 280, lives: 9, max_lives: 10, energy: 70, max_energy: 100 }, towers: [], enemies: [], wave: 12, score: 15800 } },
  { tick: 15000, timestamp: '2024-03-12T14:20:00Z', game_state: { resources: { gold: 1250, mana: 340, lives: 8, max_lives: 10, energy: 75, max_energy: 100 }, towers: [], enemies: [], wave: 23, score: 38750 } }
]

// Mock Season Rankings
export const mockRankings: SeasonRanking[] = [
  { rank: 1, agent_id: 'agent_004', agent_name: 'TowerMaster-Pro', owner: 'ai_labs', score: 892500, wins: 187, losses: 23, win_rate: 0.89, avg_duration_ms: 2850000, highest_wave: 50, difficulty_cleared: ['NORMAL', 'HARD', 'HELL', 'NIGHTMARE'], last_match: '2024-03-12T15:00:00Z', trend: 'stable', rank_change: 0 },
  { rank: 2, agent_id: 'agent_001', agent_name: 'DeepDefender-v3', owner: 'team_alpha', score: 845200, wins: 168, losses: 42, win_rate: 0.80, avg_duration_ms: 2650000, highest_wave: 48, difficulty_cleared: ['NORMAL', 'HARD', 'HELL'], last_match: '2024-03-12T14:22:00Z', trend: 'up', rank_change: 2 },
  { rank: 3, agent_id: 'agent_002', agent_name: 'NeuralTower-X', owner: 'lab_omega', score: 782100, wins: 145, losses: 68, win_rate: 0.68, avg_duration_ms: 2420000, highest_wave: 45, difficulty_cleared: ['NORMAL', 'HARD', 'HELL'], last_match: '2024-03-12T13:45:00Z', trend: 'down', rank_change: -1 },
  { rank: 4, agent_id: 'agent_006', agent_name: 'SentinelAI', owner: 'defense_corp', score: 721800, wins: 132, losses: 78, win_rate: 0.63, avg_duration_ms: 2180000, highest_wave: 42, difficulty_cleared: ['NORMAL', 'HARD'], last_match: '2024-03-12T12:30:00Z', trend: 'up', rank_change: 3 },
  { rank: 5, agent_id: 'agent_007', agent_name: 'GuardianNet', owner: 'ml_studio', score: 698500, wins: 125, losses: 85, win_rate: 0.60, avg_duration_ms: 2050000, highest_wave: 40, difficulty_cleared: ['NORMAL', 'HARD'], last_match: '2024-03-12T11:45:00Z', trend: 'down', rank_change: -2 },
  { rank: 6, agent_id: 'agent_003', agent_name: 'StrategicMind', owner: 'solo_dev', score: 652300, wins: 112, losses: 98, win_rate: 0.53, avg_duration_ms: 1920000, highest_wave: 38, difficulty_cleared: ['NORMAL', 'HARD'], last_match: '2024-03-11T22:30:00Z', trend: 'stable', rank_change: 0 },
  { rank: 7, agent_id: 'agent_008', agent_name: 'FortressAI', owner: 'tech_guild', score: 598700, wins: 98, losses: 112, win_rate: 0.47, avg_duration_ms: 1780000, highest_wave: 35, difficulty_cleared: ['NORMAL'], last_match: '2024-03-12T10:20:00Z', trend: 'up', rank_change: 1 },
  { rank: 8, agent_id: 'agent_009', agent_name: 'WatchTower-v2', owner: 'indie_ai', score: 545200, wins: 85, losses: 125, win_rate: 0.40, avg_duration_ms: 1650000, highest_wave: 32, difficulty_cleared: ['NORMAL'], last_match: '2024-03-12T09:15:00Z', trend: 'down', rank_change: -1 },
  { rank: 9, agent_id: 'agent_010', agent_name: 'DefenseCore', owner: 'academy', score: 498900, wins: 72, losses: 138, win_rate: 0.34, avg_duration_ms: 1520000, highest_wave: 28, difficulty_cleared: ['NORMAL'], last_match: '2024-03-12T08:30:00Z', trend: 'stable', rank_change: 0 },
  { rank: 10, agent_id: 'agent_005', agent_name: 'DefenseNet-Alpha', owner: 'startup_xyz', score: 285600, wins: 31, losses: 58, win_rate: 0.35, avg_duration_ms: 1280000, highest_wave: 22, difficulty_cleared: [], last_match: '2024-03-12T11:20:00Z', trend: 'down', rank_change: -3 }
]

// Mock Difficulty Progress
export const mockDifficultyProgress: DifficultyProgress[] = [
  { difficulty: 'NORMAL', unlocked: true, cleared: true, best_score: 72500, best_wave: 50, attempts: 45, clear_rate: 0.82, requirements: [] },
  { difficulty: 'HARD', unlocked: true, cleared: true, best_score: 67200, best_wave: 50, attempts: 38, clear_rate: 0.58, requirements: ['Clear NORMAL'] },
  { difficulty: 'HELL', unlocked: true, cleared: false, best_score: 45800, best_wave: 35, attempts: 24, clear_rate: 0.25, requirements: ['Clear HARD', 'Win rate > 50%'] },
  { difficulty: 'NIGHTMARE', unlocked: false, cleared: false, best_score: 0, best_wave: 0, attempts: 0, clear_rate: 0, requirements: ['Clear HELL', 'Total score > 500k'] },
  { difficulty: 'INFERNO', unlocked: false, cleared: false, best_score: 0, best_wave: 0, attempts: 0, clear_rate: 0, requirements: ['Clear NIGHTMARE', 'Season Top 10'] }
]

// Mock Towers (for current game state)
export const mockTowers: Tower[] = [
  { id: 'tw_001', type: 'CANNON', level: 3, position: { x: 5, y: 8 }, kills: 124, damage_dealt: 185000, upgrades: 2, status: 'active' },
  { id: 'tw_002', type: 'LASER', level: 4, position: { x: 8, y: 10 }, kills: 287, damage_dealt: 420000, upgrades: 3, status: 'active' },
  { id: 'tw_003', type: 'TESLA', level: 2, position: { x: 10, y: 6 }, kills: 156, damage_dealt: 198000, upgrades: 1, status: 'charging' },
  { id: 'tw_004', type: 'FROST', level: 3, position: { x: 12, y: 12 }, kills: 45, damage_dealt: 52000, upgrades: 2, status: 'active' },
  { id: 'tw_005', type: 'MISSILE', level: 5, position: { x: 15, y: 8 }, kills: 312, damage_dealt: 580000, upgrades: 4, status: 'active' },
  { id: 'tw_006', type: 'FLAME', level: 2, position: { x: 7, y: 14 }, kills: 198, damage_dealt: 245000, upgrades: 1, status: 'overheated' }
]

// Mock Enemies (for current game state)
export const mockEnemies: Enemy[] = [
  { id: 'en_001', type: 'GRUNT', health: 450, max_health: 500, position: { x: 22, y: 8 }, speed: 1.2, armor: 5, status: 'moving' },
  { id: 'en_002', type: 'TANK', health: 2800, max_health: 3500, position: { x: 20, y: 10 }, speed: 0.6, armor: 25, status: 'moving' },
  { id: 'en_003', type: 'SWIFT', health: 180, max_health: 200, position: { x: 18, y: 6 }, speed: 2.5, armor: 0, status: 'moving' },
  { id: 'en_004', type: 'ELITE', health: 1500, max_health: 2000, position: { x: 16, y: 12 }, speed: 1.0, armor: 15, status: 'attacking' },
  { id: 'en_005', type: 'BOSS', health: 8500, max_health: 15000, position: { x: 14, y: 8 }, speed: 0.4, armor: 40, status: 'moving' },
  { id: 'en_006', type: 'HEALER', health: 600, max_health: 800, position: { x: 24, y: 10 }, speed: 0.8, armor: 10, status: 'moving' }
]

// Stats for Dashboard
export const mockDashboardStats = {
  total_runs_today: 1247,
  active_runs: 23,
  total_agents: 156,
  active_agents: 89,
  season_matches: 8542,
  avg_match_duration: '28:45',
  top_difficulty_cleared: 'NIGHTMARE',
  server_load: 67
}

export interface CoreMapCell {
  x: number
  y: number
  kind: 'path' | 'build' | 'blocked' | 'relay' | 'gate' | 'core' | 'hazard'
}

export interface CoreTowerBuild {
  id: string
  name: string
  role: string
  cell: { x: number; y: number }
  tier: number
  core: 'BALLISTA' | 'MORTAR' | 'FROST' | 'CURSE' | 'FURNACE' | 'CHAIN'
  status: 'stable' | 'overdrive' | 'jammed' | 'corrupted'
  targetMode: '前锋' | '重甲' | '热量最高' | '精英优先'
  modules: string[]
  heat: number
  dps: number
  note: string
  quickActions: CoreQuickActionSlot[]
}

export interface CoreEnemyWave {
  id: string
  name: string
  threat: 'low' | 'medium' | 'high' | 'boss'
  lane: '北' | '中' | '南'
  count: number
  hp: number
  maxHp: number
  position: { x: number; y: number }
  intent: string
}

export interface CoreDecisionOption {
  id: string
  label: string
  cost: string
  payoff: string
  risk: string
  locked?: boolean
}

export interface CoreQuickActionSlot {
  key: 'Q' | 'W' | 'E' | 'R'
  actionId: string
  label: string
  detail: string
  cost: string
  availability: 'ready' | 'locked' | 'cooldown'
  reason?: string
}

export interface RouteNodeState {
  id: string
  zone: number
  index: number
  type: 'combat' | 'elite' | 'shop' | 'event' | 'camp' | 'boss'
  title: string
  modifier: string
  cleared: boolean
  active: boolean
}

export interface CoreRunScenario {
  runId: string
  title: string
  agentName: string
  difficulty: Run['difficulty']
  seed: number
  zoneName: string
  currentNode: string
  waveLabel: string
  currentTick: number
  maxTicks: number
  score: number
  fortressIntegrity: number
  maintenanceDebt: number
  routePressure: string
  resources: {
    gold: number
    heat: number
    heat_limit: number
    mana: number
    mana_limit: number
    repair: number
    threat: number
    fortress: number
    fortress_max: number
  }
  routeNodes: RouteNodeState[]
  cells: CoreMapCell[]
  towers: CoreTowerBuild[]
  enemies: CoreEnemyWave[]
  relics: string[]
  buildQueue: Array<{
    id: string
    label: string
    eta: string
    reason: string
  }>
  actionWindow: {
    type: string
    deadlineMs: number
    summary: string
    options: CoreDecisionOption[]
    quickActions: CoreQuickActionSlot[]
  }
  routeForecast: Array<{
    path: string
    reward: string
    cost: string
    risk: string
  }>
  objectiveStack: Array<{
    label: string
    detail: string
    severity: 'info' | 'warning' | 'critical'
  }>
}

const pathCoordinates = new Set([
  '0,8', '1,8', '2,8', '3,8', '4,8', '5,8', '6,8', '7,8', '8,8', '9,8', '10,8', '11,8', '12,8', '13,8', '14,8', '15,8', '16,8', '17,8',
  '4,0', '4,1', '4,2', '4,3', '4,4', '4,5', '4,6', '4,7', '4,9', '4,10', '4,11', '4,12', '4,13', '4,14', '4,15', '4,16', '4,17',
  '12,0', '12,1', '12,2', '12,3', '12,4', '12,5', '12,6', '12,7', '12,9', '12,10', '12,11', '12,12', '12,13', '12,14', '12,15', '12,16', '12,17',
  '8,4', '9,4', '10,4', '11,4', '8,12', '9,12', '10,12', '11,12'
])

const relayCoordinates = new Set(['8,4', '9,4', '8,12', '9,12'])
const gateCoordinates = new Set(['4,0', '12,0', '17,8'])
const hazardCoordinates = new Set(['10,7', '10,9', '13,12'])
const coreCoordinates = new Set(['0,8'])
const blockedCoordinates = new Set(['6,3', '6,4', '6,5', '14,3', '14,4', '14,5', '7,14', '8,14', '9,14'])

export const mockCoreMapCells: CoreMapCell[] = Array.from({ length: 18 * 18 }, (_, index) => {
  const x = index % 18
  const y = Math.floor(index / 18)
  const key = `${x},${y}`

  if (coreCoordinates.has(key)) {
    return { x, y, kind: 'core' }
  }
  if (gateCoordinates.has(key)) {
    return { x, y, kind: 'gate' }
  }
  if (hazardCoordinates.has(key)) {
    return { x, y, kind: 'hazard' }
  }
  if (relayCoordinates.has(key)) {
    return { x, y, kind: 'relay' }
  }
  if (pathCoordinates.has(key)) {
    return { x, y, kind: 'path' }
  }
  if (blockedCoordinates.has(key)) {
    return { x, y, kind: 'blocked' }
  }
  return { x, y, kind: 'build' }
})

export const mockCoreTowers: CoreTowerBuild[] = [
  {
    id: 'core_tw_01',
    name: '断颈弩机',
    role: '单核斩杀',
    cell: { x: 6, y: 7 },
    tier: 3,
    core: 'BALLISTA',
    status: 'stable',
    targetMode: '精英优先',
    modules: ['穿刺膛线', '暴露印记'],
    heat: 18,
    dps: 481,
    note: '负责处理精英与重甲单位，但对群体压力无能为力。',
    quickActions: [
      { key: 'Q', actionId: 'upgrade-ballista', label: '升级弩机', detail: '提升单体穿透并解锁四阶模块槽。', cost: '118 金币', availability: 'ready' },
      { key: 'W', actionId: 'retarget-elite', label: '精英优先', detail: '锁定精英与 Boss 段位目标。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'burst-window', label: '穿刺爆发', detail: '8 秒内提高斩杀线，但增加热量。', cost: '+12 热量', availability: 'cooldown', reason: '冷却 6.0 秒' },
      { key: 'R', actionId: 'sell-ballista', label: '拆除回收', detail: '回收 60% 造价并释放塔位。', cost: '-1 维修点', availability: 'locked', reason: '当前为主输出，不建议拆除' }
    ]
  },
  {
    id: 'core_tw_02',
    name: '坍缩迫击',
    role: '区域爆发',
    cell: { x: 8, y: 6 },
    tier: 2,
    core: 'MORTAR',
    status: 'overdrive',
    targetMode: '前锋',
    modules: ['抛物增程', '余震破片'],
    heat: 34,
    dps: 392,
    note: '用于压制双入口汇流点，收益高，但热量上涨过快。',
    quickActions: [
      { key: 'Q', actionId: 'upgrade-mortar', label: '升级迫击', detail: '提高爆炸半径与落点精度。', cost: '96 金币', availability: 'ready' },
      { key: 'W', actionId: 'switch-frontline', label: '锁前锋', detail: '优先处理即将入汇流点的前锋敌群。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'cool-vent', label: '喷口降温', detail: '降低当前塔热量 18 点。', cost: '22 法能', availability: 'ready' },
      { key: 'R', actionId: 'artillery-overdrive', label: '强制过载', detail: '短时间提高范围伤害并扩大溅射。', cost: '+16 热量', availability: 'ready' }
    ]
  },
  {
    id: 'core_tw_03',
    name: '寒蚀棱镜',
    role: '控场延滞',
    cell: { x: 10, y: 5 },
    tier: 2,
    core: 'FROST',
    status: 'jammed',
    targetMode: '前锋',
    modules: ['霜层扩散', '冻结阈值'],
    heat: 11,
    dps: 144,
    note: '被污染地块干扰，当前冻结效率下降，急需维修点解除卡壳。',
    quickActions: [
      { key: 'Q', actionId: 'upgrade-frost', label: '升级棱镜', detail: '提高冻结覆盖率与减速深度。', cost: '88 金币', availability: 'ready' },
      { key: 'W', actionId: 'retarget-lane', label: '切北路', detail: '把冻结优先级切到北路污染敌。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'purge-corruption', label: '应急去污', detail: '解除卡壳并恢复冻结链。', cost: '2 维修点', availability: 'ready' },
      { key: 'R', actionId: 'rebuild-frost', label: '重构塔核', detail: '拆解为新塔核底座，保留 1 个模块。', cost: '3 维修点', availability: 'cooldown', reason: '需进入营地节点后执行' }
    ]
  },
  {
    id: 'core_tw_04',
    name: '熵咒祭台',
    role: '乘法增伤',
    cell: { x: 9, y: 10 },
    tier: 3,
    core: 'CURSE',
    status: 'stable',
    targetMode: '热量最高',
    modules: ['裂隙回响', '债务收割'],
    heat: 23,
    dps: 201,
    note: '本身输出不高，但会把高热目标转化为全队乘法收益。',
    quickActions: [
      { key: 'Q', actionId: 'upgrade-curse', label: '升级祭台', detail: '提高易伤倍率与持续时间。', cost: '104 金币', availability: 'ready' },
      { key: 'W', actionId: 'mark-hottest', label: '标记高热', detail: '强制锁定热量最高敌群。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'debt-harvest', label: '债务收割', detail: '把敌方热量转成全队乘区。', cost: '28 法能', availability: 'ready' },
      { key: 'R', actionId: 'sell-curse', label: '拆除回收', detail: '回收祭台并返还部分模块。', cost: '-1 维修点', availability: 'locked', reason: '当前乘区核心，不建议移除' }
    ]
  },
  {
    id: 'core_tw_05',
    name: '熔锻炉心',
    role: '高热爆发',
    cell: { x: 11, y: 9 },
    tier: 4,
    core: 'FURNACE',
    status: 'overdrive',
    targetMode: '重甲',
    modules: ['回火回路', '熔蚀喷口'],
    heat: 49,
    dps: 622,
    note: '当前主输出来源，也是热量失控的主要根源。',
    quickActions: [
      { key: 'Q', actionId: 'upgrade-furnace', label: '升级炉心', detail: '提高高热伤害与护甲熔解。', cost: '146 金币', availability: 'ready' },
      { key: 'W', actionId: 'switch-heavy', label: '锁重甲', detail: '优先攻击高护甲重型单位。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'heat-dump', label: '紧急降温', detail: '快速排热，降低爆表风险。', cost: '35 法能', availability: 'ready' },
      { key: 'R', actionId: 'furnace-overdrive', label: '炉心超载', detail: '提高 10 秒爆发，结束后热量飙升。', cost: '+18 热量', availability: 'ready' }
    ]
  },
  {
    id: 'core_tw_06',
    name: '链弧节点',
    role: '汇流清线',
    cell: { x: 7, y: 11 },
    tier: 2,
    core: 'CHAIN',
    status: 'stable',
    targetMode: '前锋',
    modules: ['分叉电弧', '导体扩链'],
    heat: 16,
    dps: 338,
    note: '依赖路口布局吃满收益，若下一节点封路，其价值会骤降。',
    quickActions: [
      { key: 'Q', actionId: 'upgrade-chain', label: '升级链弧', detail: '提高连锁跳数与导电范围。', cost: '92 金币', availability: 'ready' },
      { key: 'W', actionId: 'switch-frontline-chain', label: '切前锋', detail: '优先清理已入汇流点的前锋目标。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'relay-boost', label: '继电强化', detail: '扩大本回路路口覆盖，强化汇流清线。', cost: '18 法能', availability: 'ready' },
      { key: 'R', actionId: 'reroute-support', label: '重构支路', detail: '为下一节点预埋导电支路。', cost: '2 维修点', availability: 'cooldown', reason: '需等待当前战斗结算' }
    ]
  }
]

export const mockCoreEnemies: CoreEnemyWave[] = [
  {
    id: 'core_enemy_01',
    name: '碎盾重步群',
    threat: 'high',
    lane: '中',
    count: 7,
    hp: 5320,
    maxHp: 7600,
    position: { x: 13, y: 8 },
    intent: '进入中路汇流后触发护甲循环，压制单体高伤塔。'
  },
  {
    id: 'core_enemy_02',
    name: '裂隙织法者',
    threat: 'medium',
    lane: '北',
    count: 4,
    hp: 1840,
    maxHp: 2800,
    position: { x: 11, y: 4 },
    intent: '会污染北侧两个塔位，逼迫你用维修点去污染。'
  },
  {
    id: 'core_enemy_03',
    name: '余烬巨像',
    threat: 'boss',
    lane: '南',
    count: 1,
    hp: 12800,
    maxHp: 18000,
    position: { x: 12, y: 12 },
    intent: '在 60% 生命时重绘入口，南路将并入主路。'
  }
]

export const mockCoreRouteNodes: RouteNodeState[] = [
  { id: 'zone3-1', zone: 3, index: 1, type: 'combat', title: '锈河防线', modifier: '双入口 + 污染地块', cleared: true, active: false },
  { id: 'zone3-2', zone: 3, index: 2, type: 'event', title: '无主熔炉', modifier: '可换高热遗物', cleared: true, active: false },
  { id: 'zone3-3', zone: 3, index: 3, type: 'elite', title: '裂隙先遣', modifier: '精英词缀 +1', cleared: true, active: false },
  { id: 'zone3-4', zone: 3, index: 4, type: 'shop', title: '黑箱商店', modifier: '维修成本 -1', cleared: false, active: true },
  { id: 'zone3-5', zone: 3, index: 5, type: 'camp', title: '废墟营地', modifier: '可重构 1 次塔核', cleared: false, active: false },
  { id: 'zone3-boss', zone: 3, index: 6, type: 'boss', title: '余烬主教', modifier: '阶段切换会封路', cleared: false, active: false }
]

export const mockCoreScenario: CoreRunScenario = {
  runId: 'run_core_s4_044',
  title: '裂谷赛季主战场',
  agentName: 'DeepDefender-v4',
  difficulty: 'HELL',
  seed: 93124577,
  zoneName: '区域 3 / 裂谷废墟',
  currentNode: '黑箱商店后的危机战斗',
  waveLabel: 'Wave 19 / 余烬巨像入场',
  currentTick: 18240,
  maxTicks: 36000,
  score: 58240,
  fortressIntegrity: 62,
  maintenanceDebt: 4,
  routePressure: '如果此战不处理热量与污染，Boss 节点会强制双入口并锁 2 个模块槽。',
  resources: {
    gold: 412,
    heat: 84,
    heat_limit: 100,
    mana: 62,
    mana_limit: 120,
    repair: 5,
    threat: 78,
    fortress: 62,
    fortress_max: 100
  },
  routeNodes: mockCoreRouteNodes,
  cells: mockCoreMapCells,
  towers: mockCoreTowers,
  enemies: mockCoreEnemies,
  relics: ['熔毁账本', '延迟冷凝片', '断层罗盘', '裂隙税印'],
  buildQueue: [
    { id: 'queue-1', label: '去污染寒蚀棱镜', eta: '2 维修点', reason: '解除卡壳，恢复冻结链。' },
    { id: 'queue-2', label: '重构南路为延滞链', eta: '3 维修点', reason: 'Boss 二阶段会把南路并入主路。' },
    { id: 'queue-3', label: '降温熔锻炉心', eta: '40 法能', reason: '把全局热量从 84 压回安全区。' }
  ],
  actionWindow: {
    type: '危机窗口 / 4.5 秒',
    deadlineMs: 4500,
    summary: '当前问题不是输出不够，而是热量和污染会让你在 Boss 前失去转型能力。',
    options: [
      { id: 'opt-1', label: '用维修点去污染寒蚀棱镜', cost: '2 维修点', payoff: '恢复北路冻结链', risk: '延后主堡修复' },
      { id: 'opt-2', label: '强开熔锻炉心超载', cost: '+18 热量', payoff: '立刻击穿重甲波', risk: '下一窗口可能热崩' },
      { id: 'opt-3', label: '改路封死南路支线', cost: '3 维修点', payoff: '降低 Boss 二阶段冲线速度', risk: '营地节点转型预算不足' },
      { id: 'opt-4', label: '跳过操作保留资源', cost: '0', payoff: '保留转型余量', risk: '主堡本波额外承压', locked: false }
    ],
    quickActions: [
      { key: 'Q', actionId: 'opt-1', label: '去污染棱镜', detail: '恢复北路冻结链。', cost: '2 维修点', availability: 'ready' },
      { key: 'W', actionId: 'opt-2', label: '炉心超载', detail: '短期击穿重甲波。', cost: '+18 热量', availability: 'ready' },
      { key: 'E', actionId: 'opt-3', label: '封死南路', detail: '降低 Boss 二阶段冲线速度。', cost: '3 维修点', availability: 'ready' },
      { key: 'R', actionId: 'opt-4', label: '保留资源', detail: '跳过操作，保留转型余量。', cost: '0', availability: 'ready' }
    ]
  },
  routeForecast: [
    { path: '黑箱商店 -> 废墟营地 -> 余烬主教', reward: '稳定转型窗口', cost: '放弃高稀有遗物', risk: 'Boss 血量更厚' },
    { path: '黑箱商店 -> 裂谷事件 -> 余烬主教', reward: '高乘法遗物', cost: '热量上限 -10', risk: '更容易过载暴毙' },
    { path: '黑箱商店 -> 精英捷径 -> 余烬主教', reward: '额外维修点', cost: '精英词缀 +1', risk: '若未清污染会直接崩盘' }
  ],
  objectiveStack: [
    { label: '压热', detail: '在 Boss 前把热量降到 65 以下。', severity: 'critical' },
    { label: '保维修', detail: '至少保留 2 点维修用于二阶段改路。', severity: 'warning' },
    { label: '维持冻结链', detail: '让北路冻结覆盖率回到 70% 以上。', severity: 'info' }
  ]
}

export const mockCoreSnapshots: ReplaySnapshot[] = [
  {
    tick: 0,
    timestamp: '2026-03-13T11:00:00Z',
    game_state: {
      resources: { gold: 650, mana: 90, lives: 100, max_lives: 100, energy: 100, max_energy: 100 },
      towers: [],
      enemies: [],
      wave: 1,
      score: 0
    }
  },
  {
    tick: 7200,
    timestamp: '2026-03-13T11:08:00Z',
    game_state: {
      resources: { gold: 510, mana: 70, lives: 91, max_lives: 100, energy: 78, max_energy: 100 },
      towers: [],
      enemies: [],
      wave: 7,
      score: 14800
    }
  },
  {
    tick: 14400,
    timestamp: '2026-03-13T11:16:00Z',
    game_state: {
      resources: { gold: 438, mana: 64, lives: 74, max_lives: 100, energy: 69, max_energy: 100 },
      towers: [],
      enemies: [],
      wave: 14,
      score: 39100
    }
  },
  {
    tick: 18240,
    timestamp: '2026-03-13T11:22:00Z',
    game_state: {
      resources: { gold: 412, mana: 62, lives: 62, max_lives: 100, energy: 54, max_energy: 100 },
      towers: [],
      enemies: [],
      wave: 19,
      score: 58240
    }
  }
]
