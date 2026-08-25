import { useEffect, useMemo, useState } from 'react'
import {
  PVE_ONBOARDING_VERSION,
  createPveOnboardingProgress,
  currentPveOnboardingStep,
  derivePveOnboardingFacts,
  parsePveOnboardingProgress,
  pausePveOnboarding,
  pveOnboardingStorageKey,
  reconcilePveOnboardingProgress,
  resumePveOnboarding,
  shouldResetPveOnboardingFromQuery,
  skipAllPveOnboarding,
  skipPveOnboardingStep,
  type PveOnboardingObservation,
} from './pve-onboarding'

export function usePveOnboarding(playerId: string, observation: PveOnboardingObservation | null) {
  const storageKey = pveOnboardingStorageKey(playerId)
  const [progress, setProgress] = useState(() => {
    if (typeof window === 'undefined') return createPveOnboardingProgress()
    const reset = shouldResetPveOnboardingFromQuery(import.meta.env.DEV, window.location.search)
    if (reset) {
      try { window.localStorage.removeItem(storageKey) }
      catch { /* storage can be unavailable in privacy mode */ }
      return createPveOnboardingProgress()
    }
    try {
      return parsePveOnboardingProgress(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'))
    }
    catch {
      return createPveOnboardingProgress()
    }
  })
  const facts = useMemo(() => observation ? derivePveOnboardingFacts(observation) : null, [observation])

  useEffect(() => {
    if (!facts) return
    setProgress(current => reconcilePveOnboardingProgress(current, facts))
  }, [facts])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem(storageKey, JSON.stringify(progress)) }
    catch { /* session-only fallback */ }
  }, [progress, storageKey])

  const currentStep = facts ? currentPveOnboardingStep(progress, facts) : null
  const inIntroWaves = Boolean(facts?.running && facts.currentWave <= 5)
  return {
    version: PVE_ONBOARDING_VERSION,
    progress,
    facts,
    currentStep,
    visible: Boolean(inIntroWaves && currentStep && progress.status === 'active'),
    paused: Boolean(inIntroWaves && progress.status === 'paused'),
    skipStep: () => currentStep && setProgress(current => skipPveOnboardingStep(current, currentStep)),
    skipAll: () => setProgress(skipAllPveOnboarding),
    pause: () => setProgress(pausePveOnboarding),
    resume: () => setProgress(resumePveOnboarding),
  }
}
