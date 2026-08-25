import { PassiveRuleProjection } from './types'

export interface RecruitRuleProfile {
  characterProbabilityBps: number
  pityTriggerAfterNoCharacterBatches?: number
  reserveCapacity: number
  populationCap: number
}

export interface RecruitPityState {
  noCharacterPaidBatchStreak: number
}

export interface RecruitBatchRuleInput {
  isPaidRecruit: boolean
  isFirstBatch: boolean
  generatedKinds: readonly ('soldier' | 'character')[]
  hasRemainingCharacterToken: boolean
  pityState: RecruitPityState
  /** 服务端 PRNG 已确定的索引；必须落入候选集合，回放直接使用事件中的最终结果。 */
  chooseIndex: (candidateIndexes: readonly number[], reason: 'first_batch_soldier' | 'character_pity') => number
}

export interface RecruitBatchRuleResult {
  finalKinds: readonly ('soldier' | 'character')[]
  forcedSoldierIndex?: number
  pityCharacterIndex?: number
  nextPityState: RecruitPityState
}

export function buildRecruitRuleProfile(
  projection: PassiveRuleProjection,
  baseCharacterProbabilityBps = 1_000,
  baseReserveCapacity = 2,
  basePopulationCap = 10,
): RecruitRuleProfile {
  return {
    characterProbabilityBps: projection.characterProbabilityBps ?? baseCharacterProbabilityBps,
    pityTriggerAfterNoCharacterBatches: projection.characterPity?.triggerAfterNoCharacterBatches,
    reserveCapacity: baseReserveCapacity + projection.reserveCapacityBonus,
    populationCap: basePopulationCap + projection.populationCapBonus,
  }
}

/**
 * 实现设计稿锁定顺序中的第 3、4、6 步。字符 Token 的实际消费由征兵适配器原子提交，
 * 本函数只产出确定的槽位种类决策，不复制、创建或移动 Token。
 */
export function applyRecruitBatchGuarantees(
  input: RecruitBatchRuleInput,
  projection: PassiveRuleProjection,
): RecruitBatchRuleResult {
  const finalKinds = [...input.generatedKinds]
  let forcedSoldierIndex: number | undefined
  let pityCharacterIndex: number | undefined

  if (input.isFirstBatch && finalKinds.length > 0 && finalKinds.every((kind) => kind === 'character')) {
    forcedSoldierIndex = chooseValidatedIndex(
      input.chooseIndex,
      finalKinds.map((_, index) => index),
      'first_batch_soldier',
    )
    setRecruitKind(finalKinds, forcedSoldierIndex, 'soldier')
  }

  const pity = projection.characterPity
  const isPityBatch = Boolean(
    input.isPaidRecruit
    && pity
    && input.pityState.noCharacterPaidBatchStreak >= pity.triggerAfterNoCharacterBatches,
  )
  if (
    isPityBatch
    && input.hasRemainingCharacterToken
    && finalKinds.every((kind) => kind === 'soldier')
  ) {
    const candidates = finalKinds
      .map((_, index) => index)
      .filter((index) => index !== forcedSoldierIndex)
    if (candidates.length > 0) {
      pityCharacterIndex = chooseValidatedIndex(input.chooseIndex, candidates, 'character_pity')
      setRecruitKind(finalKinds, pityCharacterIndex, 'character')
    }
  }

  const hasCharacter = finalKinds.some((kind) => kind === 'character')
  const nextStreak = input.isPaidRecruit
    ? (hasCharacter ? 0 : input.pityState.noCharacterPaidBatchStreak + 1)
    : input.pityState.noCharacterPaidBatchStreak

  return {
    finalKinds,
    forcedSoldierIndex,
    pityCharacterIndex,
    nextPityState: { noCharacterPaidBatchStreak: nextStreak },
  }
}

export function shouldGrantExtraBossFragment(
  rollBps: number,
  projection: PassiveRuleProjection,
): boolean {
  if (!Number.isInteger(rollBps) || rollBps < 0 || rollBps >= 10_000) {
    throw new Error('rollBps must be an integer in [0, 10000)')
  }
  return Boolean(projection.bossFragmentBonus && rollBps < projection.bossFragmentBonus.chanceBps)
}

function chooseValidatedIndex(
  chooseIndex: RecruitBatchRuleInput['chooseIndex'],
  candidates: readonly number[],
  reason: 'first_batch_soldier' | 'character_pity',
): number {
  const selected = chooseIndex(candidates, reason)
  if (!candidates.includes(selected)) throw new Error(`PRNG adapter selected illegal ${reason} index ${selected}`)
  return selected
}

function setRecruitKind(
  kinds: Array<'soldier' | 'character'>,
  index: number,
  kind: 'soldier' | 'character',
): void {
  kinds[index] = kind
}
