async (page) => {
  const browser = page.context().browser()
  const makeSide = (id, name, isSelf, loaded) => ({
    side: id === 'alice' ? 'A' : 'B', playerId: id, playerName: name, connected: true,
    disconnectedAtTick: null, ready: true, loaded, loadStatus: loaded ? 'loaded' : 'loading',
    loadFailureCode: null, loadAcknowledgedAtTick: loaded ? 1 : null, coreHp: 10, coreMaxHp: 10,
    rations: isSelf ? 10 : null, scripture: isSelf ? 0 : null, populationUsed: 0, populationCap: 10,
    boardPieces: [], enemies: [],
    stats: { playerId: id, side: id === 'alice' ? 'A' : 'B', result: null, coreHpRemaining: 10,
      baseKills: 0, pressureKills: 0, leaks: 0, scriptureEarned: 0, scriptureSpent: 0,
      pressureSent: 0, pressureLeaked: 0, coreDamageDealt: 0, rationsEarned: 0,
      rationsSpent: 0, paidRecruitCount: 0, activeGeneralIds: [], peakPopulation: 0,
      highestSoldierLevel: 0, damageDealt: 0, controlDurationMs: 0 },
    privateState: isSelf ? { tray: [null, null, null, null, null], reserve: [null, null], pendingPressure: [], trayRevision: 0, reserveRevision: 0, boardRevision: 0 } : null,
  })
  const makeState = (selfId, selfSide, selfLoaded) => {
    const aIsSelf = selfSide === 'A'
    return {
      schemaVersion: 1, matchId: 'dual-load-demo', mode: 'custom_1v1', phase: 'loading', tick: 80,
      tickRateMs: 100, rulesetVersion: 'pvp_rules_v1', mapId: 'pvp_dual_realm_v1', mapVersion: 1,
      routeHash: 'route-hash-demo', countdownRemainingTicks: 0,
      loading: { rulesetVersion: 'pvp_rules_v1', mapId: 'pvp_dual_realm_v1', mapVersion: 1,
        routeHash: 'route-hash-demo', assetsVersion: 'pvp_assets_v1', deadlineAtTick: 450, remainingTicks: 370 },
      round: { number: 0, nextRoundAtTick: null, intervalTicks: 200, baseCountPerSide: 10 },
      tribulation: { active: false, tier: 0, hpBonusBps: 0, moveSpeedBonusBps: 0, coreDamageBonus: 0,
        oneLeakDefeat: false, hardTimeoutAtTick: 7200 },
      sides: {
        A: makeSide('alice', '悟空', aIsSelf, aIsSelf ? selfLoaded : true),
        B: makeSide('bob', '杨戬', !aIsSelf, !aIsSelf ? selfLoaded : false),
      }, result: null, recentEvents: [], viewerPlayerId: selfId,
    }
  }
  const install = async (target, selfId, selfSide) => {
    let loaded = false
    let ackCount = 0
    await target.unroute(/\/api\/pvp\//).catch(() => {})
    await target.route(/\/api\/pvp\//, async route => {
      const path = route.request().url()
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (path.endsWith('/load-ack')) { loaded = true; ackCount += 1; return json({ ok: true, code: 'PLAYER_LOADED', requestId: 'visual', duplicate: false, tick: 80 }) }
      if (path.endsWith('/events')) {
        const state = makeState(selfId, selfSide, loaded)
        const body = `id: 1\nevent: pvp-state\ndata: ${JSON.stringify({ kind: 'full', matchId: 'dual-load-demo', seq: 1, state })}\n\n`
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body })
      }
      if (path.endsWith('/state')) return json({ ok: true, state: makeState(selfId, selfSide, loaded) })
      if (path.endsWith('/profile')) return json({ ok: true, profile: { playerId: selfId, playerName: selfId, tutorialCompleted: true, loadoutValid: true, region: 'auto', rating: {} } })
      if (path.includes('/seasons/current')) return json({ ok: true, season: { seasonId: 's1', name: '技术预览', status: 'active', rulesetVersion: 'pvp_rules_v1', mapIds: ['pvp_dual_realm_v1'] } })
      if (path.endsWith('/rooms')) return json({ ok: true, rooms: [] })
      if (path.includes('/leaderboard')) return json({ ok: true, leaderboard: { entries: [] } })
      if (path.endsWith('/matches')) return json({ ok: true, matches: [] })
      return json({ ok: true, detail: {} })
    })
    return () => ackCount
  }
  const getAliceAck = await install(page, 'alice', 'A')
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('http://127.0.0.1:5189/pvp/game/dual-load-demo')
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pageB = await contextB.newPage()
  const getBobAck = await install(pageB, 'bob', 'B')
  await pageB.goto('http://127.0.0.1:5189/pvp/game/dual-load-demo')
  await page.waitForTimeout(1700)
  await pageB.waitForTimeout(1700)
  await page.screenshot({ path: '/Users/yueyue/AI项目/A2A/AgensTD/output/playwright/pvp-load-alice-1280x720.png' })
  await pageB.screenshot({ path: '/Users/yueyue/AI项目/A2A/AgensTD/output/playwright/pvp-load-bob-390x844.png' })
  const result = {
    aliceAck: getAliceAck(), bobAck: getBobAck(),
    aliceText: await page.locator('.pvp-loading-stage').innerText(),
    bobText: await pageB.locator('.pvp-loading-stage').innerText(),
    aliceOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    bobOverflow: await pageB.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  }
  await contextB.close()
  return result
}
