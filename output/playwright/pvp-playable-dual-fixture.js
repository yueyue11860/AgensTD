async (page) => {
  const browser = page.context().browser()
  const soldiers = {
    blade: { soldierType: 'blade', glyph: '刀', name: '刀卫', attackStyle: 'single', damage: 12, rangeMilli: 2200, attackIntervalMs: 700, armorPierce: 0 },
    spear: { soldierType: 'spear', glyph: '枪', name: '枪卫', attackStyle: 'pierce', damage: 9, rangeMilli: 3200, attackIntervalMs: 950, armorPierce: 2 },
    bow: { soldierType: 'bow', glyph: '弓', name: '弓卫', attackStyle: 'ranged', damage: 8, rangeMilli: 5200, attackIntervalMs: 850, armorPierce: 0 },
    cavalry: { soldierType: 'cavalry', glyph: '骑', name: '骑卫', attackStyle: 'splash', damage: 10, rangeMilli: 2800, attackIntervalMs: 1150, armorPierce: 1 },
  }
  const slotsA = [{x:5,y:2},{x:8,y:2},{x:11,y:2},{x:17,y:2},{x:20,y:2},{x:23,y:2},{x:2,y:7},{x:26,y:7},{x:2,y:9},{x:26,y:9}]
  const slotsB = slotsA.map(({x,y}) => ({x,y:28-y}))
  const rulesSnapshot = { snapshotVersion:'pvp_rules_snapshot_v1', catalogVersion:'pvp_loaner_four_v1', recruitCost:3, initialRations:10, roundRations:5, populationCap:10, pressureCost:5, maxMergeLevel:3, deploymentSlots:{A:slotsA,B:slotsB}, soldiers }
  const install = async (target, selfId, selfSide) => {
    let seq = 1
    let unit = null
    let board = []
    let rations = 15
    let trayRevision = 0
    let boardRevision = 0
    let events = []
    const makeSide = (side, id, owner) => ({
      side, playerId:id, playerName:side === 'A' ? '悟空' : '杨戆', connected:true, disconnectedAtTick:null,
      ready:true, loaded:true, loadStatus:'loaded', loadFailureCode:null, loadAcknowledgedAtTick:1,
      coreHp:10, coreMaxHp:10, rations:owner?rations:null, scripture:owner?0:null,
      populationUsed:owner?board.length:1, populationCap:10,
      boardPieces:owner?board:[{entityId:`other-${side}`,ownerPlayerId:id,kind:'soldier',glyph:'弓',soldierType:'bow',level:1,...(side==='A'?slotsA[2]:slotsB[2])}],
      enemies:[{enemyId:`enemy-${side}`,side,kind:'base',glyph:'妖',roundNumber:1,xMilli:10000,yMilli:3000,routeCellIndex:8,routeProgressMilli:400,hp:19,maxHp:28,armor:0,magicResistance:0,moveSpeedMilliCellsPerSecond:1000,coreDamage:1,spawnProtected:false,pressureSourcePlayerId:null,pressureRequestId:null}],
      stats:{playerId:id,side,result:null,coreHpRemaining:10,baseKills:1,pressureKills:0,leaks:0,scriptureEarned:1,scriptureSpent:0,pressureSent:0,pressureLeaked:0,coreDamageDealt:0,rationsEarned:1,rationsSpent:15,paidRecruitCount:5,activeGeneralIds:[],peakPopulation:5,highestSoldierLevel:1,damageDealt:24,controlDurationMs:0},
      privateState:owner?{tray:[unit,null,null,null,null],reserve:[null,null],pendingPressure:[],trayRevision,reserveRevision:0,boardRevision}:null,
    })
    const state = () => ({schemaVersion:1,matchId:'playable-dual-demo',mode:'custom_1v1',phase:'playing',tick:260,tickRateMs:100,rulesetVersion:'pvp_rules_v1',mapId:'pvp_dual_realm_v1',mapVersion:1,routeHash:'fixture-route',rulesSnapshot,countdownRemainingTicks:0,loading:{rulesetVersion:'pvp_rules_v1',mapId:'pvp_dual_realm_v1',mapVersion:1,routeHash:'fixture-route',assetsVersion:'pvp_assets_v1',deadlineAtTick:null,remainingTicks:0},round:{number:1,nextRoundAtTick:400,intervalTicks:200,baseCountPerSide:10},tribulation:{active:false,tier:0,hpBonusBps:0,moveSpeedBonusBps:0,coreDamageBonus:0,oneLeakDefeat:false,hardTimeoutAtTick:7200},sides:{A:makeSide('A','alice',selfSide==='A'),B:makeSide('B','bob',selfSide==='B')},result:null,recentEvents:events,viewerPlayerId:selfId})
    await target.route(/\/api\/pvp\//, async route => {
      const path = route.request().url()
      const fulfill = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
      if (path.endsWith('/recruit')) { unit={unitId:`unit-${selfId}`,soldierType:'blade',glyph:'刀',level:1}; rations-=3; trayRevision+=1; seq+=1; events=[{eventId:`recruit-${selfId}`,tick:260,type:'PIECE_RECRUITED',data:{playerId:selfId}}]; return fulfill({ok:true,code:'PIECE_RECRUITED',tick:260,details:{unitId:unit.unitId,glyph:'刀'}}) }
      if (path.endsWith('/deploy')) { const body=route.request().postDataJSON(); board=[{entityId:unit.unitId,ownerPlayerId:selfId,kind:'soldier',glyph:'刀',soldierType:'blade',level:1,x:body.x,y:body.y}]; unit=null; trayRevision+=1; boardRevision+=1; seq+=1; events=[{eventId:`deploy-${selfId}`,tick:261,type:'PIECE_DEPLOYED',data:{playerId:selfId}},{eventId:`attack-${selfId}`,tick:262,type:'PIECE_ATTACKED',data:{playerId:selfId,attackStyle:'single'}}]; return fulfill({ok:true,code:'PIECE_DEPLOYED',tick:261}) }
      if (path.endsWith('/events')) return route.fulfill({status:200,headers:{'Content-Type':'text/event-stream'},body:`id: ${seq}\nevent: pvp-state\ndata: ${JSON.stringify({kind:'full',matchId:'playable-dual-demo',seq,state:state()})}\n\n`})
      if (path.endsWith('/state')) return fulfill({ok:true,state:state()})
      if (path.endsWith('/profile')) return fulfill({ok:true,profile:{playerId:selfId,playerName:selfId,tutorialCompleted:true,loadoutValid:true,region:'auto',rating:{}}})
      if (path.includes('/seasons/current')) return fulfill({ok:true,season:{seasonId:'s1',name:'技术预览',status:'active',rulesetVersion:'pvp_rules_v1',mapIds:['pvp_dual_realm_v1']}})
      if (path.endsWith('/rooms')) return fulfill({ok:true,rooms:[]})
      if (path.includes('/leaderboard')) return fulfill({ok:true,leaderboard:{entries:[]}})
      if (path.endsWith('/matches')) return fulfill({ok:true,matches:[]})
      return fulfill({ok:true})
    })
    return () => ({board:board.length,rations,trayRevision,boardRevision})
  }
  const alice = await install(page,'alice','A')
  await page.setViewportSize({width:1280,height:720})
  await page.goto('http://127.0.0.1:5190/pvp/game/playable-dual-demo')
  const contextB = await browser.newContext({viewport:{width:390,height:844}})
  const pageB = await contextB.newPage()
  const bob = await install(pageB,'bob','B')
  await pageB.goto('http://127.0.0.1:5190/pvp/game/playable-dual-demo')
  for (const target of [page,pageB]) {
    await target.getByRole('button',{name:/招募 · 3斋饭/}).click()
    await target.locator('.pvp-tray-units button').click()
    await target.locator('.pvp-deployment-zone:not(.pvp-opponent-zone) .pvp-deploy-cell').first().click()
    await target.waitForTimeout(450)
  }
  await pageB.waitForTimeout(1_200)
  await page.screenshot({path:'/Users/yueyue/AI项目/A2A/AgensTD/output/playwright/pvp-playable-alice-1280x720.png',fullPage:true})
  await pageB.screenshot({path:'/Users/yueyue/AI项目/A2A/AgensTD/output/playwright/pvp-playable-bob-390x844.png',fullPage:true})
  const result={alice:alice(),bob:bob(),aliceOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),bobOverflow:await pageB.evaluate(()=>document.documentElement.scrollWidth>innerWidth),aliceButtons:await page.locator('.pvp-deploy-cell').count(),bobButtons:await pageB.locator('.pvp-deploy-cell').count()}
  await contextB.close()
  return result
}
