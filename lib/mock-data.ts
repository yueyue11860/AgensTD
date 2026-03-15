// Mock Data for Roguelike Tower Defense AI Competition Platform

import type {
  Agent,
  CoreEnemyWave,
  CoreMapCell,
  CoreReplaySnapshot,
  CoreRunScenario,
  CoreTowerBuild,
  DifficultyProgress,
  RouteNodeState,
  Run,
  SeasonRanking,
} from './domain.ts'
import { MVP_CORE_TOWER_TYPES } from './game/rules.ts'

export type {
  Agent,
  CoreEnemyWave,
  CoreMapCell,
  CoreReplaySnapshot,
  CoreRunScenario,
  CoreTowerBuild,
  DifficultyProgress,
  RouteNodeState,
  Run,
  SeasonRanking,
} from '@/lib/domain'

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
    resources: { gold: 1250, heat: 84, heat_limit: 100, mana: 340, mana_limit: 120, repair: 5, threat: 78, fortress: 62, fortress_max: 100 },
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
    difficulty: 'HELL',
    seed: 98712345,
    status: 'running',
    start_time: '2024-03-12T13:45:00Z',
    current_tick: 22100,
    max_ticks: 50000,
    score: 52400,
    wave: 31,
    max_wave: 50,
    resources: { gold: 2100, heat: 91, heat_limit: 110, mana: 520, mana_limit: 140, repair: 3, threat: 88, fortress: 48, fortress_max: 100 },
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
    resources: { gold: 5200, heat: 42, heat_limit: 120, mana: 890, mana_limit: 140, repair: 8, threat: 39, fortress: 74, fortress_max: 100 },
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
    difficulty: 'EASY',
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
    resources: { gold: 0, heat: 100, heat_limit: 100, mana: 0, mana_limit: 100, repair: 0, threat: 100, fortress: 0, fortress_max: 100 },
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
    resources: { gold: 500, heat: 20, heat_limit: 100, mana: 100, mana_limit: 100, repair: 4, threat: 18, fortress: 100, fortress_max: 100 },
    towers_built: 0,
    enemies_killed: 0,
    damage_dealt: 0,
    damage_taken: 0,
    is_live: false
  }
]

// Mock Season Rankings
export const mockRankings: SeasonRanking[] = [
  { rank: 1, agent_id: 'agent_004', agent_name: 'TowerMaster-Pro', owner: 'ai_labs', score: 892500, wins: 187, losses: 23, win_rate: 0.89, avg_duration_ms: 2850000, highest_wave: 50, difficulty_cleared: ['EASY', 'NORMAL', 'HARD', 'HELL'], last_match: '2024-03-12T15:00:00Z', trend: 'stable', rank_change: 0 },
  { rank: 2, agent_id: 'agent_001', agent_name: 'DeepDefender-v3', owner: 'team_alpha', score: 845200, wins: 168, losses: 42, win_rate: 0.80, avg_duration_ms: 2650000, highest_wave: 48, difficulty_cleared: ['EASY', 'NORMAL', 'HARD'], last_match: '2024-03-12T14:22:00Z', trend: 'up', rank_change: 2 },
  { rank: 3, agent_id: 'agent_002', agent_name: 'NeuralTower-X', owner: 'lab_omega', score: 782100, wins: 145, losses: 68, win_rate: 0.68, avg_duration_ms: 2420000, highest_wave: 45, difficulty_cleared: ['EASY', 'NORMAL', 'HARD'], last_match: '2024-03-12T13:45:00Z', trend: 'down', rank_change: -1 },
  { rank: 4, agent_id: 'agent_006', agent_name: 'SentinelAI', owner: 'defense_corp', score: 721800, wins: 132, losses: 78, win_rate: 0.63, avg_duration_ms: 2180000, highest_wave: 42, difficulty_cleared: ['EASY', 'NORMAL'], last_match: '2024-03-12T12:30:00Z', trend: 'up', rank_change: 3 },
  { rank: 5, agent_id: 'agent_007', agent_name: 'GuardianNet', owner: 'ml_studio', score: 698500, wins: 125, losses: 85, win_rate: 0.60, avg_duration_ms: 2050000, highest_wave: 40, difficulty_cleared: ['EASY', 'NORMAL'], last_match: '2024-03-12T11:45:00Z', trend: 'down', rank_change: -2 },
  { rank: 6, agent_id: 'agent_003', agent_name: 'StrategicMind', owner: 'solo_dev', score: 652300, wins: 112, losses: 98, win_rate: 0.53, avg_duration_ms: 1920000, highest_wave: 38, difficulty_cleared: ['EASY', 'NORMAL'], last_match: '2024-03-11T22:30:00Z', trend: 'stable', rank_change: 0 },
  { rank: 7, agent_id: 'agent_008', agent_name: 'FortressAI', owner: 'tech_guild', score: 598700, wins: 98, losses: 112, win_rate: 0.47, avg_duration_ms: 1780000, highest_wave: 35, difficulty_cleared: ['EASY'], last_match: '2024-03-12T10:20:00Z', trend: 'up', rank_change: 1 },
  { rank: 8, agent_id: 'agent_009', agent_name: 'WatchTower-v2', owner: 'indie_ai', score: 545200, wins: 85, losses: 125, win_rate: 0.40, avg_duration_ms: 1650000, highest_wave: 32, difficulty_cleared: ['EASY'], last_match: '2024-03-12T09:15:00Z', trend: 'down', rank_change: -1 },
  { rank: 9, agent_id: 'agent_010', agent_name: 'DefenseCore', owner: 'academy', score: 498900, wins: 72, losses: 138, win_rate: 0.34, avg_duration_ms: 1520000, highest_wave: 28, difficulty_cleared: ['EASY'], last_match: '2024-03-12T08:30:00Z', trend: 'stable', rank_change: 0 },
  { rank: 10, agent_id: 'agent_005', agent_name: 'DefenseNet-Alpha', owner: 'startup_xyz', score: 285600, wins: 31, losses: 58, win_rate: 0.35, avg_duration_ms: 1280000, highest_wave: 22, difficulty_cleared: [], last_match: '2024-03-12T11:20:00Z', trend: 'down', rank_change: -3 }
]

// Mock Difficulty Progress
export const mockDifficultyProgress: DifficultyProgress[] = [
  { difficulty: 'EASY', unlocked: true, cleared: true, best_score: 72500, best_wave: 50, attempts: 45, clear_rate: 0.82, requirements: [] },
  { difficulty: 'NORMAL', unlocked: true, cleared: true, best_score: 67200, best_wave: 50, attempts: 38, clear_rate: 0.58, requirements: ['Clear EASY'] },
  { difficulty: 'HARD', unlocked: true, cleared: false, best_score: 45800, best_wave: 35, attempts: 24, clear_rate: 0.25, requirements: ['Clear NORMAL'] },
  { difficulty: 'HELL', unlocked: false, cleared: false, best_score: 0, best_wave: 0, attempts: 0, clear_rate: 0, requirements: ['Clear HARD'] }
]

// Stats for Dashboard
export const mockDashboardStats = {
  total_runs_today: 1247,
  active_runs: 23,
  total_agents: 156,
  active_agents: 89,
  season_matches: 8542,
  avg_match_duration: '28:45',
  top_difficulty_cleared: 'HELL',
  server_load: 67
}

const MAP_COLUMNS = 25
const MAP_ROWS = 20

const pathCoordinates = (() => {
  const entries = new Set<string>()

  for (let x = 0; x < MAP_COLUMNS; x += 1) {
    entries.add(`${x},9`)
  }

  for (let y = 0; y < MAP_ROWS; y += 1) {
    if (y !== 9) {
      entries.add(`4,${y}`)
      entries.add(`18,${y}`)
    }
  }

  for (let x = 9; x <= 11; x += 1) {
    entries.add(`${x},3`)
    entries.add(`${x},15`)
  }

  for (let x = 13; x <= 15; x += 1) {
    entries.add(`${x},3`)
  }

  return entries
})()

const relayCoordinates = new Set(['9,3', '10,3', '9,15', '10,15'])
const gateCoordinates = new Set(['4,0', '18,0', '24,9'])
const hazardCoordinates = new Set(['14,8', '14,10', '18,14'])
const coreCoordinates = new Set(['0,9'])
const blockedCoordinates = new Set(['8,3', '8,4', '8,5', '20,3', '20,4', '20,5', '9,16', '10,16', '11,16'])

export const mockCoreMapCells: CoreMapCell[] = Array.from({ length: MAP_COLUMNS * MAP_ROWS }, (_, index) => {
  const x = index % MAP_COLUMNS
  const y = Math.floor(index / MAP_COLUMNS)
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
    id: 'arrow_01',
    name: '箭塔',
    role: '单体压制',
    cell: { x: 7, y: 8 },
    tier: 3,
    core: 'ARROW',
    status: 'ready',
    targetMode: '前锋',
    footprint: { width: 1, height: 1 },
    range: 1,
    attackRate: 1.5,
    damage: 20,
    dps: 30,
    effects: ['稳定单体输出。'],
    note: '负责补主路斩杀线，优先处理快要漏过去的前锋单位。',
    quickActions: [
      { key: 'Q', actionId: 'arrow_01-upgrade', actionType: 'UPGRADE', targetKind: 'tower', targetId: 'arrow_01', label: '升级箭塔', detail: '提升攻速与单点斩杀能力。', cost: '已满级', availability: 'locked', reason: '该建筑最多 3 级。' },
      { key: 'W', actionId: 'arrow_01-retarget', actionType: 'RETARGET', targetKind: 'tower', targetId: 'arrow_01', label: '切换到末尾', detail: '切换锁定优先级。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'arrow_01-cast', actionType: 'CAST', targetKind: 'tower', targetId: 'arrow_01', label: '连射压制', detail: '对当前主目标执行一次主动追击。', cost: '2 法力', availability: 'ready' },
      { key: 'R', actionId: 'arrow_01-sell', actionType: 'SELL', targetKind: 'tower', targetId: 'arrow_01', label: '拆除回收', detail: '拆除建筑并回收部分金币。', cost: '+60% 造价', availability: 'ready' }
    ]
  },
  {
    id: 'cannon_01',
    name: '炮塔',
    role: '范围爆发',
    cell: { x: 11, y: 7 },
    tier: 2,
    core: 'CANNON',
    status: 'boosted',
    targetMode: '高生命',
    footprint: { width: 1, height: 2 },
    range: 3,
    attackRate: 0.7,
    damage: 10,
    dps: 8.4,
    effects: ['3x3 范围攻击。'],
    note: '补在路口附近，用来清理扎堆的敌军簇。',
    quickActions: [
      { key: 'Q', actionId: 'cannon_01-upgrade', actionType: 'UPGRADE', targetKind: 'tower', targetId: 'cannon_01', label: '升级炮塔', detail: '提高范围输出。', cost: '8 金币', availability: 'ready' },
      { key: 'W', actionId: 'cannon_01-retarget', actionType: 'RETARGET', targetKind: 'tower', targetId: 'cannon_01', label: '切换到低生命', detail: '切换锁定优先级。', cost: '0', availability: 'ready' },
      { key: 'E', actionId: 'cannon_01-cast', actionType: 'CAST', targetKind: 'tower', targetId: 'cannon_01', label: '震荡齐射', detail: '立即补一轮 3x3 溅射伤害。', cost: '2 法力', availability: 'ready' },
      { key: 'R', actionId: 'cannon_01-sell', actionType: 'SELL', targetKind: 'tower', targetId: 'cannon_01', label: '拆除回收', detail: '拆除建筑并回收部分金币。', cost: '+60% 造价', availability: 'ready' }
    ]
  },
  {
    id: 'supply_01',
    name: '补给站',
    role: '攻速光环',
    cell: { x: 13, y: 6 },
    tier: 2,
    core: 'SUPPLY',
    status: 'ready',
    targetMode: '前锋',
    footprint: { width: 1, height: 1 },
    range: 6,
    attackRate: 0,
    damage: 0,
    dps: 0,
    effects: ['6x6 范围友军攻速 +20%。'],
    note: '覆盖主路交汇区，给箭塔和炮塔提速。',
    quickActions: [
      { key: 'Q', actionId: 'supply_01-upgrade', actionType: 'UPGRADE', targetKind: 'tower', targetId: 'supply_01', label: '升级补给站', detail: '扩大光环收益。', cost: '9 金币', availability: 'ready' },
      { key: 'W', actionId: 'supply_01-retarget', actionType: 'RETARGET', targetKind: 'tower', targetId: 'supply_01', label: '切换到末尾', detail: '功能建筑不依赖目标优先级。', cost: '0', availability: 'locked', reason: '功能建筑不需要重设目标。' },
      { key: 'E', actionId: 'supply_01-cast', actionType: 'CAST', targetKind: 'tower', targetId: 'supply_01', label: '战地提速', detail: '短时间再拉高附近友军攻速。', cost: '1 法力', availability: 'ready' },
      { key: 'R', actionId: 'supply_01-sell', actionType: 'SELL', targetKind: 'tower', targetId: 'supply_01', label: '拆除回收', detail: '拆除建筑并回收部分金币。', cost: '+60% 造价', availability: 'ready' }
    ]
  },
  {
    id: 'mine_01',
    name: '矿场',
    role: '经济产出',
    cell: { x: 14, y: 12 },
    tier: 3,
    core: 'MINE',
    status: 'ready',
    targetMode: '前锋',
    footprint: { width: 2, height: 2 },
    range: 0,
    attackRate: 0,
    damage: 0,
    dps: 0,
    effects: ['每 6 秒产出 1 金币。'],
    note: '已经进入稳定采矿周期，适合在局势平稳时滚经济。',
    storedGold: 3,
    quickActions: [
      { key: 'Q', actionId: 'mine_01-upgrade', actionType: 'UPGRADE', targetKind: 'tower', targetId: 'mine_01', label: '升级矿场', detail: '缩短采矿周期。', cost: '已满级', availability: 'locked', reason: '该建筑最多 3 级。' },
      { key: 'W', actionId: 'mine_01-retarget', actionType: 'RETARGET', targetKind: 'tower', targetId: 'mine_01', label: '切换到末尾', detail: '功能建筑不依赖目标优先级。', cost: '0', availability: 'locked', reason: '功能建筑不需要重设目标。' },
      { key: 'E', actionId: 'mine_01-cast', actionType: 'CAST', targetKind: 'tower', targetId: 'mine_01', label: '提早收矿', detail: '立即结算当前累计产出。', cost: '0', availability: 'ready' },
      { key: 'R', actionId: 'mine_01-sell', actionType: 'SELL', targetKind: 'tower', targetId: 'mine_01', label: '拆除回收', detail: '拆除建筑并回收部分金币。', cost: '+60% 造价', availability: 'ready' }
    ]
  }
]

export const mockCoreEnemies: CoreEnemyWave[] = [
  {
    id: 'core_enemy_01',
    name: '携盾群',
    threat: 'high',
    lane: '中',
    count: 6,
    hp: 188,
    maxHp: 240,
    position: { x: 19, y: 9 },
    speed: 1.6,
    baseSpeed: 1.6,
    armor: 0.16,
    maxArmor: 0.16,
    slowFactor: 0,
    burnRatio: 0,
    statusText: '无异常状态',
    intent: '高护甲成团推进，适合用炮塔和电塔处理。'
  },
  {
    id: 'core_enemy_02',
    name: '散兵群',
    threat: 'medium',
    lane: '北',
    count: 5,
    hp: 122,
    maxHp: 160,
    position: { x: 17, y: 4 },
    speed: 1.9,
    baseSpeed: 1.9,
    armor: 0.08,
    maxArmor: 0.08,
    slowFactor: 0,
    burnRatio: 0,
    statusText: '无异常状态',
    intent: '速度较快，冰塔和箭塔更容易稳住这一路。'
  },
  {
    id: 'core_enemy_03',
    name: '攻城巨像',
    threat: 'boss',
    lane: '南',
    count: 1,
    hp: 420,
    maxHp: 420,
    position: { x: 18, y: 14 },
    speed: 1.1,
    baseSpeed: 1.1,
    armor: 0.28,
    maxArmor: 0.28,
    slowFactor: 0,
    burnRatio: 0,
    statusText: '无异常状态',
    intent: '会测试你是否具备多格火力、减防和持续灼烧的完整链路。'
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
  runId: 'run_buildings_s1_001',
  rulesVersion: 'buildings-v2',
  title: '建筑体系主战场',
  agentName: 'DeepDefender-v4',
  difficulty: 'NORMAL',
  seed: 93124577,
  zoneName: '区域 2 / 试验防线',
  currentNode: '多路线建筑测试',
  waveLabel: 'Wave 6 / 复合兵种推进',
  currentTick: 5760,
  maxTicks: 24000,
  score: 920,
  fortressIntegrity: 78,
  maintenanceDebt: 1,
  routePressure: '本局重点是验证新建筑体系的占地、范围、光环和经济是否协同工作。',
  resources: {
    gold: 9,
    heat: 28,
    heat_limit: 100,
    mana: 8,
    mana_limit: 20,
    repair: 4,
    threat: 34,
    fortress: 78,
    fortress_max: 100
  },
  supportedTowerCores: MVP_CORE_TOWER_TYPES,
  routeNodes: mockCoreRouteNodes,
  cells: mockCoreMapCells,
  towers: mockCoreTowers,
  enemies: mockCoreEnemies,
  relics: ['工程手册', '折返路标'],
  buildQueue: [
    { id: 'queue-1', label: '补电塔减防', eta: '下一准备阶段', reason: '当前对高护甲敌群的处理仍然偏慢。' },
    { id: 'queue-2', label: '维持补给站覆盖', eta: '持续', reason: '箭塔和炮塔都吃补给站的攻速光环。' },
    { id: 'queue-3', label: '继续滚矿场', eta: '本轮结算', reason: '局势尚稳，可以继续扩大金币优势。' }
  ],
  actionWindow: {
    type: 'prep',
    label: '波前准备 / 6 秒',
    deadlineMs: 6000,
    summary: '点击地块后，可直接在这里选择要建造的建筑。',
    options: [
      { id: 'option-build-arrow', label: '建造箭塔', cost: '1 金币', payoff: '快速补单体输出', risk: '群体压力仍需别的建筑处理' },
      { id: 'option-build-cannon', label: '建造炮塔', cost: '2 金币', payoff: '补 3x3 范围伤害', risk: '会占用纵向 1x2 塔位' },
      { id: 'option-build-supply', label: '建造补给站', cost: '1 金币', payoff: '抬高附近友军攻速', risk: '本身不提供直接伤害' },
      { id: 'option-build-mine', label: '建造矿场', cost: '1 金币', payoff: '开始滚动经济', risk: '本身不提供直接伤害' }
    ],
    quickActions: [
      { key: '1', actionId: 'build-ARROW', actionType: 'BUILD', targetKind: 'cell', targetId: 'ARROW', label: '建造箭塔', detail: '稳定单体输出。', cost: '1 金币', availability: 'ready' },
      { key: '2', actionId: 'build-ICE', actionType: 'BUILD', targetKind: 'cell', targetId: 'ICE', label: '建造冰塔', detail: '单体减速控场。', cost: '2 金币', availability: 'ready' },
      { key: '3', actionId: 'build-CANNON', actionType: 'BUILD', targetKind: 'cell', targetId: 'CANNON', label: '建造炮塔', detail: '3x3 范围爆发。', cost: '2 金币', availability: 'ready' },
      { key: '4', actionId: 'build-LASER', actionType: 'BUILD', targetKind: 'cell', targetId: 'LASER', label: '建造激光塔', detail: '持续聚焦增伤。', cost: '3 金币', availability: 'ready' },
      { key: '5', actionId: 'build-TESLA', actionType: 'BUILD', targetKind: 'cell', targetId: 'TESLA', label: '建造电塔', detail: '范围减防压血。', cost: '3 金币', availability: 'ready' },
      { key: '6', actionId: 'build-MAGIC', actionType: 'BUILD', targetKind: 'cell', targetId: 'MAGIC', label: '建造魔法塔', detail: '全屏永久灼烧。', cost: '3 金币', availability: 'ready' },
      { key: '7', actionId: 'build-SUPPLY', actionType: 'BUILD', targetKind: 'cell', targetId: 'SUPPLY', label: '建造补给站', detail: '6x6 攻速光环。', cost: '1 金币', availability: 'ready' },
      { key: '8', actionId: 'build-MINE', actionType: 'BUILD', targetKind: 'cell', targetId: 'MINE', label: '建造矿场', detail: '持续产出金币。', cost: '1 金币', availability: 'ready' }
    ]
  },
  routeForecast: [
    { path: '商店 -> 营地 -> Boss', reward: '稳定资源窗口', cost: '爆发收益偏低', risk: 'Boss 血量更厚' },
    { path: '事件 -> 精英 -> Boss', reward: '更多金币与遗物', cost: '主堡压力更大', risk: '若火力结构不完整会直接漏怪' },
    { path: '营地 -> 事件 -> Boss', reward: '补线更稳', cost: '推进更慢', risk: '经济滚动速度下降' }
  ],
  objectiveStack: [
    { label: '补齐功能位', detail: '当前建议补电塔或魔法塔，让伤害链完整。', severity: 'critical' },
    { label: '维持经济', detail: '矿场已经运转，尽量不要轻易拆除。', severity: 'warning' },
    { label: '让光环吃满', detail: '把主要输出建筑留在补给站 6x6 覆盖范围内。', severity: 'info' }
  ]
}

export const mockCoreSnapshots: CoreReplaySnapshot[] = [
  {
    tick: 0,
    timestamp: '2026-03-13T11:00:00Z',
    game_state: {
      resources: { gold: 6, heat: 10, heat_limit: 100, mana: 6, mana_limit: 20, repair: 5, threat: 10, fortress: 100, fortress_max: 100 },
      towers: [],
      enemies: [],
      wave: 1,
      score: 0,
      phase: 'PREP',
      observation_version: 1
    }
  },
  {
    tick: 1920,
    timestamp: '2026-03-13T11:08:00Z',
    game_state: {
      resources: { gold: 5, heat: 18, heat_limit: 100, mana: 7, mana_limit: 20, repair: 4, threat: 18, fortress: 94, fortress_max: 100 },
      towers: mockCoreTowers.slice(0, 2),
      enemies: [],
      wave: 3,
      score: 280,
      phase: 'COMBAT',
      observation_version: 2
    }
  },
  {
    tick: 3840,
    timestamp: '2026-03-13T11:16:00Z',
    game_state: {
      resources: { gold: 8, heat: 24, heat_limit: 100, mana: 8, mana_limit: 20, repair: 4, threat: 28, fortress: 85, fortress_max: 100 },
      towers: mockCoreTowers,
      enemies: mockCoreEnemies.slice(0, 2),
      wave: 5,
      score: 620,
      phase: 'RESOLUTION',
      observation_version: 3
    }
  },
  {
    tick: 5760,
    timestamp: '2026-03-13T11:22:00Z',
    game_state: {
      resources: { gold: 9, heat: 28, heat_limit: 100, mana: 8, mana_limit: 20, repair: 4, threat: 34, fortress: 78, fortress_max: 100 },
      towers: mockCoreTowers,
      enemies: mockCoreEnemies,
      wave: 6,
      score: 920,
      phase: 'DECISION',
      observation_version: 4
    }
  }
]
