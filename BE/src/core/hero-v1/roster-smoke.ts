import assert from 'node:assert/strict'
import {
  GENERAL_IDS,
  GENERAL_ROSTER,
  getGeneralRosterEntry,
  validateGeneralRoster,
} from './roster'
import type { GeneralRosterEntry } from './roster'

export function runGeneralRosterSmokeChecks(): void {
  validateGeneralRoster()

  assert.equal(GENERAL_ROSTER.length, 21)
  assert.deepEqual(
    GENERAL_ROSTER.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.profession] = (counts[entry.profession] ?? 0) + 1
      return counts
    }, {}),
    { physical: 6, magic: 5, summon: 4, control: 6 },
  )

  assert.equal(getGeneralRosterEntry(GENERAL_IDS.HOUYI)?.displayName, '后羿')
  assert.equal(getGeneralRosterEntry(GENERAL_IDS.CHANG_E)?.displayName, '嫦娥')
  assert.equal(getGeneralRosterEntry(GENERAL_IDS.YANGJIAN)?.displayName, '杨戬')
  assert.equal(getGeneralRosterEntry(GENERAL_IDS.NAZHA)?.displayName, '哪吒')
  assert.equal(getGeneralRosterEntry(GENERAL_IDS.LIJING)?.displayName, '李靖')
  assert.equal(getGeneralRosterEntry(GENERAL_IDS.SUNWUKONG)?.displayName, '孙悟空')
  assert.equal(getGeneralRosterEntry('unknown_general'), null)

  assert.throws(
    () => validateGeneralRoster(GENERAL_ROSTER.slice(0, 20)),
    /exactly 21 entries/,
  )

  const duplicateIdRoster: GeneralRosterEntry[] = GENERAL_ROSTER.map((entry) => ({ ...entry }))
  duplicateIdRoster[1] = {
    ...duplicateIdRoster[1]!,
    generalId: duplicateIdRoster[0]!.generalId,
  }
  assert.throws(() => validateGeneralRoster(duplicateIdRoster), /Duplicate generalId/)

  const duplicateRecipeRoster: GeneralRosterEntry[] = GENERAL_ROSTER.map((entry) => ({ ...entry }))
  duplicateRecipeRoster[1] = {
    ...duplicateRecipeRoster[1]!,
    glyphs: [...duplicateRecipeRoster[0]!.glyphs],
  }
  assert.throws(() => validateGeneralRoster(duplicateRecipeRoster), /Duplicate general recipe/)

  const wrongQualityRoster: GeneralRosterEntry[] = GENERAL_ROSTER.map((entry) => ({ ...entry }))
  wrongQualityRoster[0] = {
    ...wrongQualityRoster[0]!,
    quality: 'red',
  }
  assert.throws(() => validateGeneralRoster(wrongQualityRoster), /invalid 2-glyph quality/)

  const wrongProfessionCountRoster: GeneralRosterEntry[] = GENERAL_ROSTER.map((entry) => ({ ...entry }))
  wrongProfessionCountRoster[0] = {
    ...wrongProfessionCountRoster[0]!,
    profession: 'magic',
  }
  assert.throws(() => validateGeneralRoster(wrongProfessionCountRoster), /profession physical/)
}

if (require.main === module) {
  runGeneralRosterSmokeChecks()
  console.log('hero-v1 roster smoke checks passed')
}
