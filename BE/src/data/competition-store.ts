import type { DualLeaderboard, MatchResultRecord, ReplaySummary } from '../domain/competition'
import type { MatchReplay } from '../domain/replay'

/**
 * 持久化边界。游戏循环和网络层只依赖该接口，具体实现可以是
 * Supabase、腾讯云自建 PostgreSQL，或测试用内存存储。
 */
export interface CompetitionStore {
  isEnabled(): boolean
  upsertReplay(replay: MatchReplay, summary: ReplaySummary): Promise<void>
  persistMatchResults(results: MatchResultRecord[]): Promise<void>
  listRecentReplays(limit: number): Promise<ReplaySummary[]>
  getReplay(matchId: string): Promise<MatchReplay | null>
  getDualLeaderboards(limit: number): Promise<DualLeaderboard>
}
