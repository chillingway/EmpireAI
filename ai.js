const STORAGE_KEY = "empireAI.childBrain.v1";
const SCOREBOARD_VERSION = 4;

function defaultBrain() {
  return {
    lessons: 0,
    scoreboardVersion: SCOREBOARD_VERSION,
    records: {
      human: { wins: 0, losses: 0 },
      ai: { wins: 0, losses: 0 },
    },
    weights: {
      captureCity: 7,
      captureNeutralCity: 8.5,
      landCaptureNeutralCity: 10,
      attackEnemy: 2.4,
      attackTransport: 7.5,
      shoreAttackShip: 4.8,
      shoreAttackLoadedTransport: 6.5,
      boardTransport: 1.8,
      boardForNeutralExpansion: 4.4,
      emptyTransportTowardCargo: 5.6,
      emptyTransportNearCargo: 4.8,
      emptyTransportNearShore: 1.6,
      transportEscape: 4.2,
      uselessEmptyTransportMove: -3.2,
      amphibiousAdvance: 4.4,
      amphibiousNeutralAdvance: 5.2,
      fuelReturnToCity: 7.5,
      lowFuelDanger: -6.5,
      unloadTransport: 5.2,
      loadedTransportAdvance: 5.4,
      loadedTransportNeutralAdvance: 7.2,
      unloadNearCity: 4.6,
      unloadNearNeutralCity: 6.4,
      moveToCity: 2.2,
      cityAdvance: 3,
      neutralCityAdvance: 4.8,
      neutralCityPressure: 3.8,
      landNeutralCityAdvance: 6.2,
      landNeutralCityPressure: 5.4,
      cityPressure: 1.5,
      moveToEnemy: 0.65,
      moveToTransport: 2.8,
      boostProduction: 1.4,
      protectCity: 0.35,
      stayAlive: 0.8,
    },
  };
}

function loadBrain() {
  try {
    return normalizeBrain(JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultBrain());
  } catch {
    return defaultBrain();
  }
}

let brain = loadBrain();

function normalizeBrain(savedBrain) {
  const freshBrain = defaultBrain();
  const keepVisibleRecords = savedBrain?.scoreboardVersion === SCOREBOARD_VERSION;

  return {
    ...freshBrain,
    ...savedBrain,
    scoreboardVersion: SCOREBOARD_VERSION,
    records: {
      human: {
        wins: keepVisibleRecords ? savedBrain?.records?.human?.wins ?? 0 : 0,
        losses: keepVisibleRecords ? savedBrain?.records?.human?.losses ?? 0 : 0,
      },
      ai: {
        wins: keepVisibleRecords ? savedBrain?.records?.ai?.wins ?? 0 : 0,
        losses: keepVisibleRecords ? savedBrain?.records?.ai?.losses ?? 0 : 0,
      },
    },
    weights: {
      ...freshBrain.weights,
      ...savedBrain?.weights,
    },
  };
}

function saveBrain() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(brain));
}


function chooseAiProductionType(owner = "ai") {
  const ownerUnits = armiesFor(owner);
  const ownerCities = citiesFor(owner).length;
  const transports = ownerUnits.filter((unit) => unit.type === "transport").length;
  const destroyers = ownerUnits.filter((unit) => unit.type === "destroyer").length;
  const fighters = ownerUnits.filter((unit) => unit.type === "fighter").length;
  const amphibious = ownerUnits.filter((unit) => unit.type === "amphibious").length;
  const tanks = ownerUnits.filter((unit) => unit.type === "tank").length;

  if (transports < Math.max(1, Math.floor(ownerCities / 3))) return "transport";
  if (destroyers < Math.max(1, Math.floor(ownerCities / 3))) return "destroyer";
  if (fighters < Math.max(1, Math.floor(ownerCities / 2))) return "fighter";
  if (amphibious < Math.max(1, Math.floor(ownerCities / 2))) return "amphibious";
  if (tanks < Math.max(1, Math.floor(ownerCities / 2))) return "tank";
  return producedUnitType();
}

function ownerUsesAiProduction(owner) {
  return owner === "ai" || state?.silent || state?.demo;
}

function chooseProductionType(owner) {
  return ownerUsesAiProduction(owner) && !humanVsHuman ? chooseAiProductionType(owner) : "infantry";
}


function nearestDistance(items, point, fallback = 12) {
  if (!items.length) return fallback;
  return Math.min(...items.map((item) => distance(point, item)));
}

function loadedTransportAdvance(army, move, targets) {
  if (army.type !== "transport" || !army.cargo?.length) return 0;
  const currentNearestTarget = nearestDistance(targets, army);
  const nearestTarget = nearestDistance(targets, move);
  const advance = Math.max(0, currentNearestTarget - nearestTarget) / unitMoveRange(army);
  const landingPressure = nearestTarget <= 2 ? (3 - nearestTarget) / 3 : 0;
  return Math.max(advance, landingPressure);
}

function unloadNearTargets(army, move, targets, currentState) {
  if (!canUnloadTransport(army, move, currentState)) return 0;
  const nearestCity = nearestDistance(targets, move);
  return nearestCity <= 5 ? (6 - nearestCity) / 6 : 0.2;
}

function transportCanUseCargo(transport, unit) {
  return unit.owner === transport.owner && unit.id !== transport.id && canBoardTransport(unit, transport);
}

function emptyTransportCargoTargets(transport, currentState) {
  if (transport.type !== "transport" || transport.cargo?.length) return [];
  return currentState.armies.filter((unit) => transportCanUseCargo(transport, unit));
}

function adjacentLandPressure(move, currentState) {
  return directions.some((dir) => {
    const x = move.x + dir.dx;
    const y = move.y + dir.dy;
    return inBounds(x, y) && currentState.terrain[y][x] === "land";
  })
    ? 1
    : 0;
}

function enemyThreatDistance(unit, currentState) {
  const enemies = currentState.armies.filter((item) => item.owner !== unit.owner);
  return nearestDistance(enemies, unit, 12);
}

function transportEscape(army, move, currentState) {
  if (army.type !== "transport") return 0;
  const currentThreat = enemyThreatDistance(army, currentState);
  if (currentThreat > 4) return 0;
  const moveThreat = enemyThreatDistance(move, currentState);
  return Math.max(0, moveThreat - currentThreat) / unitMoveRange(army);
}

function emptyTransportPickupScore(army, move, currentState) {
  const cargoTargets = emptyTransportCargoTargets(army, currentState);
  if (!cargoTargets.length) return { advance: 0, nearCargo: 0, idle: 1 };
  const currentNearestCargo = nearestDistance(cargoTargets, army);
  const nearestCargo = nearestDistance(cargoTargets, move);
  return {
    advance: Math.max(0, currentNearestCargo - nearestCargo) / unitMoveRange(army),
    nearCargo: nearestCargo <= 1 ? 1 : nearestCargo <= 3 ? (4 - nearestCargo) / 3 : 0,
    idle: 0,
  };
}

function fuelRatio(unit) {
  const max = UNIT_TYPES[unit.type]?.fuel;
  if (!Number.isFinite(unit.fuel) || !Number.isFinite(max) || max <= 0) return 1;
  return unit.fuel / max;
}

function fuelReturnScore(army, move, ownCities) {
  if (!Number.isFinite(army.fuel)) return 0;
  const ratio = fuelRatio(army);
  if (ratio > 0.45) return 0;
  const currentNearest = nearestDistance(ownCities, army);
  const nearest = nearestDistance(ownCities, move);
  const advance = Math.max(0, currentNearest - nearest) / Math.max(1, unitMoveRange(army));
  const urgency = 1 - ratio;
  const refuelNow = ownCities.some((city) => city.x === move.x && city.y === move.y) ? 1 : 0;
  return Math.max(advance, refuelNow) * urgency;
}

function lowFuelDanger(unit, move, ownCities) {
  if (!Number.isFinite(unit.fuel)) return 0;
  const projectedFuel = unit.fuel - distance(unit, move);
  const ratio = fuelRatio(unit);
  if (ratio > 0.35) return 0;
  const nearestOwnCity = nearestDistance(ownCities, move);
  const canStillReachCity = nearestOwnCity <= Math.max(0, projectedFuel);
  return canStillReachCity ? 0 : 1 - ratio;
}

function scoreMove(army, move, currentState, learningBrain) {
  const city = currentState.cities.find((item) => item.x === move.x && item.y === move.y);
  const enemy = currentState.armies.find((unit) => unit.x === move.x && unit.y === move.y && unit.owner !== army.owner);
  const friendlyTransport = currentState.armies.find(
    (unit) => unit.x === move.x && unit.y === move.y && canBoardTransport(army, unit),
  );
  const enemyCities = currentState.cities.filter((item) => item.owner !== army.owner);
  const neutralCities = currentState.cities.filter((item) => item.owner === "neutral");
  const enemyArmies = currentState.armies.filter((unit) => unit.owner !== army.owner);
  const enemyTransports = enemyArmies.filter((unit) => unit.type === "transport");
  const ownCities = currentState.cities.filter((item) => item.owner === army.owner);
  const currentNearestCity = nearestDistance(enemyCities, army);
  const nearestCity = nearestDistance(enemyCities, move);
  const currentNearestNeutralCity = nearestDistance(neutralCities, army);
  const nearestNeutralCity = nearestDistance(neutralCities, move);
  const nearestEnemy = nearestDistance(enemyArmies, move);
  const nearestTransport = nearestDistance(enemyTransports, move);
  const nearestOwnCity = nearestDistance(ownCities, move);
  const cityAdvance = Math.max(0, currentNearestCity - nearestCity) / unitMoveRange(army);
  const neutralCityAdvance = Math.max(0, currentNearestNeutralCity - nearestNeutralCity) / unitMoveRange(army);
  const cityPressure = nearestCity <= 3 ? (4 - nearestCity) / 4 : 0;
  const neutralCityPressure = nearestNeutralCity <= 4 ? (5 - nearestNeutralCity) / 5 : 0;
  const landUnit = isLandCombatUnit(army);
  const boostProduction = isFighter(army) && city?.owner === army.owner ? Math.min(city.produce, unitStrikePower(army)) / unitStrikePower(army) : 0;
  const shoreAttack = canShoreAttack(army, move, currentState);
  const loadedTransportCargo = shoreAttack && enemy?.type === "transport" ? transportCargoUsed(enemy) / TRANSPORT_CAPACITY : 0;
  const emptyTransport = army.type === "transport" && !army.cargo?.length;
  const emptyPickup = emptyTransport ? emptyTransportPickupScore(army, move, currentState) : { advance: 0, nearCargo: 0, idle: 0 };
  const amphibious = army.type === "amphibious";

  const features = {
    captureCity: city && city.owner !== army.owner && canConquerCity(army) ? 1 : 0,
    captureNeutralCity: city?.owner === "neutral" && canConquerCity(army) ? 1 : 0,
    landCaptureNeutralCity: city?.owner === "neutral" && landUnit ? 1 : 0,
    attackEnemy: enemy ? 1 : 0,
    attackTransport: enemy?.type === "transport" ? 1 : 0,
    shoreAttackShip: shoreAttack ? 1 : 0,
    shoreAttackLoadedTransport: loadedTransportCargo,
    boardTransport: friendlyTransport ? 1 : 0,
    boardForNeutralExpansion: friendlyTransport && neutralCities.length ? 1 : 0,
    emptyTransportTowardCargo: emptyPickup.advance,
    emptyTransportNearCargo: emptyPickup.nearCargo,
    emptyTransportNearShore: emptyTransport ? adjacentLandPressure(move, currentState) : 0,
    transportEscape: transportEscape(army, move, currentState),
    uselessEmptyTransportMove: emptyPickup.idle,
    amphibiousAdvance: amphibious ? Math.max(cityAdvance, cityPressure) : 0,
    amphibiousNeutralAdvance: amphibious ? Math.max(neutralCityAdvance, neutralCityPressure) : 0,
    fuelReturnToCity: fuelReturnScore(army, move, ownCities),
    lowFuelDanger: lowFuelDanger(army, move, ownCities),
    unloadTransport: canUnloadTransport(army, move, currentState) ? 1 : 0,
    loadedTransportAdvance: loadedTransportAdvance(army, move, enemyCities),
    loadedTransportNeutralAdvance: loadedTransportAdvance(army, move, neutralCities),
    unloadNearCity: unloadNearTargets(army, move, enemyCities, currentState),
    unloadNearNeutralCity: unloadNearTargets(army, move, neutralCities, currentState),
    moveToCity: (12 - nearestCity) / 12,
    cityAdvance,
    neutralCityAdvance,
    neutralCityPressure,
    landNeutralCityAdvance: landUnit ? neutralCityAdvance : 0,
    landNeutralCityPressure: landUnit ? neutralCityPressure : 0,
    cityPressure,
    moveToEnemy: (12 - nearestEnemy) / 12,
    moveToTransport: isFighter(army) ? (12 - nearestTransport) / 12 : 0,
    boostProduction,
    protectCity: (12 - nearestOwnCity) / 12,
    stayAlive: army.hp / unitMaxHp(army),
  };

  const score = Object.entries(features).reduce(
    (sum, [name, value]) => sum + value * learningBrain.weights[name],
    Math.random() * 0.3,
  );
  return { score, features };
}

function chooseAiMove(army, currentState = state, learningBrain = brain) {
  const moves = legalMoves(army, currentState);
  if (!moves.length) return null;
  const ranked = moves
    .map((move) => ({ move, ...scoreMove(army, move, currentState, learningBrain) }))
    .sort((a, b) => b.score - a.score);
  return Math.random() < 0.13 ? ranked[rand(ranked.length)] : ranked[0];
}

function rememberAiChoice(owner, features) {
  if (owner === "ai") {
    state.aiMemory.push(features);
  } else if (features.captureCity) {
    state.aiMemory.push({ captureCity: 0.25 });
  }
}

async function runAiTurn(owner = "ai", turnToken = gameToken) {
  aiTurnTimer = null;
  if (turnToken !== gameToken || state.gameOver || livePlayPaused) return;
  const aiUnits = [...armiesFor(owner)];
  const enemyOwner = opponentOwner(owner);
  const actorName = `${sideName(owner)} AI`;
  let captures = 0;
  let kills = 0;

  for (const army of aiUnits) {
    if (turnToken !== gameToken || livePlayPaused) return;
    if (!state.armies.includes(army)) continue;
    const choice = chooseAiMove(army);
    if (!choice) continue;
    selectedArmyId = army.id;
    state.log = `${actorName} moves ${unitLabelWithArticle(army)}.`;
    render();
    const beforeEnemyCount = armiesFor(enemyOwner).length;
    const result = await performVisibleMove(army, choice.move, turnToken);
    if (result.cancelled) return;
    if (result.captured) captures += 1;
    if (armiesFor(enemyOwner).length < beforeEnemyCount) kills += 1;
    rememberAiChoice(owner, choice.features);
    checkVictory();
    render();
    if (state.gameOver) return;
    if (!(await waitForLivePlay(110, turnToken))) return;
  }

  state.log = `${actorName} moved. It captured ${captures} cit${captures === 1 ? "y" : "ies"} and destroyed ${kills} unit${
    kills === 1 ? "" : "s"
  }.`;
  if (owner === "human") beginAiTurn();
  else finishRound();
}


function recordGameResult(winner) {
  const loser = winner === "human" ? "ai" : "human";
  brain.records[winner].wins += 1;
  brain.records[loser].losses += 1;
}

function learnFromGame(aiWon, options = {}) {
  const reward = aiWon ? 1 : -1;
  const rate = 0.08;
  const memories = state.aiMemory.length ? state.aiMemory : [{ stayAlive: 1 }];
  for (const features of memories) {
    for (const [name, value] of Object.entries(features)) {
      brain.weights[name] = Math.max(-2, Math.min(8, brain.weights[name] + reward * rate * value));
    }
  }
  brain.lessons += 1;
  if (options.recordResult !== false) recordGameResult(aiWon ? "ai" : "human");
  saveBrain();
}


function renderBrain() {
  const rows = [
    ["AI wins", brain.records.ai.wins],
    ["AI losses", brain.records.ai.losses],
    ["Human wins", brain.records.human.wins],
    ["Human losses", brain.records.human.losses],
  ];
  brainStats.innerHTML = rows.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join("");
}

function cloneForSim(baseState) {
  return {
    terrain: baseState.terrain.map((row) => [...row]),
    cities: baseState.cities.map((city) => ({ ...city })),
    armies: baseState.armies.map((army) => ({ ...army, cargo: army.cargo?.map((unit) => ({ ...unit })) })),
    round: baseState.round,
    phase: baseState.phase,
    gameOver: false,
    winner: null,
    victoryAnnounced: false,
    silent: true,
    recordResults: false,
    aiMemory: [],
    log: "",
  };
}

function createTrainingState() {
  const terrain = makeMap();
  const cities = placeCities(terrain);
  const humanStart = cities.find((city) => city.owner === "human");
  const aiStart = cities.find((city) => city.owner === "ai");
  const humanStartCells = nearbyLand(terrain, humanStart, START_ARMIES + START_TANKS);
  const aiStartCells = nearbyLand(terrain, aiStart, START_ARMIES + START_TANKS);

  return {
    terrain,
    cities,
    armies: [
      ...humanStartCells.slice(0, START_TANKS).map((cell) => makeUnit("human", cell.x, cell.y, "tank")),
      ...humanStartCells.slice(START_TANKS).map((cell) => makeUnit("human", cell.x, cell.y)),
      ...aiStartCells.slice(0, START_TANKS).map((cell) => makeUnit("ai", cell.x, cell.y, "tank")),
      ...aiStartCells.slice(START_TANKS).map((cell) => makeUnit("ai", cell.x, cell.y)),
    ],
    round: 1,
    phase: "training",
    gameOver: false,
    winner: null,
    victoryAnnounced: false,
    silent: true,
    recordResults: false,
    aiMemory: [],
    log: "",
  };
}

function runHiddenTrainingGame() {
  state = createTrainingState();

  while (!state.gameOver && state.round < 120) {
    for (const owner of ["human", "ai"]) {
      for (const army of [...armiesFor(owner)]) {
        if (!state.armies.includes(army)) continue;
        const choice = chooseAiMove(army, state, brain);
        if (choice?.move) {
          moveArmy(army, choice.move);
          rememberAiChoice(owner, choice.features);
        }
      }
    }
    produceArmies();
    state.round += 1;
    checkVictory();
  }

  if (!state.gameOver) {
    learnFromGame(citiesFor("ai").length + armiesFor("ai").length > citiesFor("human").length + armiesFor("human").length, {
      recordResult: false,
    });
  }
}

function setTrainingControlsEnabled(enabled) {
  endTurnBtn.disabled = !enabled;
  livePauseBtn.disabled = !enabled || state?.gameOver;
  humanVsHumanBtn.disabled = !enabled;
  trainBtn.disabled = !enabled;
  trainCountInput.disabled = !enabled;
  resetBrainBtn.disabled = !enabled;
  demoAiBtn.disabled = !enabled;
  demoTempoInput.disabled = !enabled;
}

function trainingGameCount() {
  const count = Number.parseInt(trainCountInput.value, 10);
  const safeCount = Number.isFinite(count) ? Math.min(10000, Math.max(1, count)) : 100;
  trainCountInput.value = String(safeCount);
  return safeCount;
}

async function trainGames(count) {
  if (trainingRunning) return;
  unlockAudio();
  trainingRunning = true;
  setTrainingControlsEnabled(false);
  const visibleState = state;
  const trainingToken = gameToken;

  try {
    for (let game = 1; game <= count; game += 1) {
      if (!trainingRunning || trainingToken !== gameToken) return;
      runHiddenTrainingGame();
      state = visibleState;
      trainProgress.textContent = `${game} / ${count} games trained`;
      state.log = `Training in background: ${game} / ${count} games trained.`;
      aiLessons.textContent = brain.lessons;
      renderBrain();
      await wait(0);
    }

    state = visibleState;
    state.log = `Training complete: ${count} / ${count} games trained.`;
    trainProgress.textContent = `${count} / ${count} games trained`;
    render();
    showTrainingDoneMessage(count);
  } finally {
    if (trainingToken === gameToken) {
      trainingRunning = false;
      setTrainingControlsEnabled(true);
    }
    state = visibleState;
  }
}

function demoTempoMs() {
  const seconds = Number.parseFloat(demoTempoInput.value);
  const safeSeconds = Number.isFinite(seconds) ? Math.min(3, Math.max(0.1, seconds)) : 0.5;
  demoTempoInput.value = safeSeconds.toFixed(1);
  return safeSeconds * 1000;
}

function setDemoControlsEnabled(enabled) {
  endTurnBtn.disabled = !enabled;
  humanVsHumanBtn.disabled = !enabled;
  trainBtn.disabled = !enabled;
  resetBrainBtn.disabled = !enabled;
  demoAiBtn.disabled = !enabled;
  demoTempoInput.disabled = !enabled;
}

function demoWinnerByScore() {
  const humanScore = citiesFor("human").length * 3 + armiesFor("human").length;
  const aiScore = citiesFor("ai").length * 3 + armiesFor("ai").length;
  if (humanScore === aiScore) return null;
  return humanScore > aiScore ? "human" : "ai";
}

function finishDemoTraining() {
  if (state.gameOver) return;
  const winner = demoWinnerByScore();
  if (winner) {
    state.gameOver = true;
    state.winner = winner;
    state.log =
      winner === "human"
        ? "Demo finished. Blue AI won by empire strength."
        : "Demo finished. Red AI won by empire strength.";
    learnFromGame(winner === "ai");
  } else {
    state.log = "Demo finished in balance. The AI watched a draw.";
  }
}

async function runDemoSide(owner, delayMs, demoToken) {
  state.phase = owner;
  selectedArmyId = null;
  const sideName = owner === "human" ? "Blue AI" : "Red AI";
  state.log = `${sideName} is choosing moves.`;
  render();
  if (!(await waitForLivePlay(delayMs, demoToken))) return false;

  for (const army of [...armiesFor(owner)]) {
    if (!demoRunning || demoToken !== gameToken || state.gameOver) return false;
    if (livePlayPaused && !(await waitForLivePlay(0, demoToken))) return false;
    if (!state.armies.includes(army) || army.acted) continue;
    const choice = chooseAiMove(army, state, brain);
    if (!choice) {
      army.acted = true;
      continue;
    }

    selectedArmyId = army.id;
    state.log = `${sideName} moves ${unitLabelWithArticle(army)}.`;
    render();
    if (!(await waitForLivePlay(delayMs, demoToken))) return false;

    const beforeEnemyCount = armiesFor(owner === "human" ? "ai" : "human").length;
    const result = await performVisibleMove(army, choice.move, demoToken);
    if (result.cancelled) return false;
    rememberAiChoice(owner, choice.features);
    if (result.shoreAttack && result.battle?.cargoDestroyed) {
      state.log = `${sideName} sank a transporter and destroyed ${result.battle.cargoDestroyed} cargo unit${
        result.battle.cargoDestroyed === 1 ? "" : "s"
      }.`;
    } else if (armiesFor(owner === "human" ? "ai" : "human").length < beforeEnemyCount) {
      state.log = `${sideName} destroyed an enemy unit.`;
    } else if (result.captured) {
      state.log = `${sideName} captured a city.`;
    } else {
      state.log = `${sideName} moved.`;
    }
    checkVictory();
    render();
    if (!(await waitForLivePlay(delayMs, demoToken))) return false;
  }

  return true;
}

async function runDemoAiGame() {
  if (demoRunning) return;
  unlockAudio();
  const delayMs = demoTempoMs();
  demoRunning = true;
  humanVsHuman = false;
  setDemoControlsEnabled(false);
  newGame({ demo: true, keepDemoRunning: true });
  const demoToken = gameToken;

  try {
    while (demoRunning && demoToken === gameToken && !state.gameOver && state.round <= 120) {
      const humanDone = await runDemoSide("human", delayMs, demoToken);
      if (!humanDone) break;
      const aiDone = await runDemoSide("ai", delayMs, demoToken);
      if (!aiDone) break;
      produceArmies();
      armiesFor("human").forEach((army) => {
        army.acted = false;
      });
      armiesFor("ai").forEach((army) => {
        army.acted = false;
      });
      state.round += 1;
      state.phase = "human";
      checkVictory();
      render();
      if (!(await waitForLivePlay(delayMs, demoToken))) break;
    }

    if (demoRunning && demoToken === gameToken && !state.gameOver) {
      finishDemoTraining();
      render();
    }
  } finally {
    if (demoToken === gameToken) {
      demoRunning = false;
      selectedArmyId = null;
      state.phase = "human";
      setDemoControlsEnabled(true);
      if (!state.gameOver) render();
    }
  }
}
