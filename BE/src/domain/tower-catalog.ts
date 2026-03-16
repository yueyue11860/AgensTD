export interface TowerCatalogEntry {
  type: string
  label: string
  description: string
  cost: number
  damage: number
  range: number
  fireRateTicks: number
}

export const towerCatalog: Record<string, TowerCatalogEntry> = {
  laser: {
    type: 'laser',
    label: '激光塔',
    description: '中等射程、稳定输出的标准防御塔。',
    cost: 50,
    damage: 20,
    range: 3.5,
    fireRateTicks: 4,
  },
  cannon: {
    type: 'cannon',
    label: '加农塔',
    description: '高伤害、低攻速的重型火力塔。',
    cost: 80,
    damage: 35,
    range: 2.5,
    fireRateTicks: 6,
  },
}
