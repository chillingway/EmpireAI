const SIZE = 20;
const CITY_COUNT = 10;
const START_ARMIES = 3;
const START_TANKS = 1;
const TRANSPORT_CAPACITY = 6;
const FIGHTER_FUEL = 15;
const PRODUCTION_ORDER = ["infantry", "tank", "amphibious", "transport", "destroyer", "fighter"];
const CITY_PRODUCTION_DOUBLE_CLICK_MS = 260;

const { directions, distance, farEnough, key, rand, shuffle } = window.EmpireCore;
const inBounds = (x, y) => window.EmpireCore.inBounds(x, y, SIZE);
const DEFAULT_UNIT_TYPES = window.EmpireUnits.createDefaultUnitTypes(FIGHTER_FUEL);

let UNIT_TYPES = window.EmpireUnits.normalizeUnitTypes(DEFAULT_UNIT_TYPES, DEFAULT_UNIT_TYPES);
let PRODUCTION_POOL = window.EmpireUnits.buildProductionPool(UNIT_TYPES);

async function loadUnitTypes() {
  try {
    const response = await fetch("./units.json?v=v2-unit-json-1", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unit data request failed: ${response.status}`);
    const json = await response.json();
    const source = window.EmpireUnits.mergeUnitTypeConfig(DEFAULT_UNIT_TYPES, json);
    UNIT_TYPES = window.EmpireUnits.normalizeUnitTypes(source, DEFAULT_UNIT_TYPES);
    PRODUCTION_POOL = window.EmpireUnits.buildProductionPool(UNIT_TYPES);
  } catch (error) {
    console.warn("Using fallback unit data.", error);
    UNIT_TYPES = window.EmpireUnits.normalizeUnitTypes(DEFAULT_UNIT_TYPES, DEFAULT_UNIT_TYPES);
    PRODUCTION_POOL = window.EmpireUnits.buildProductionPool(UNIT_TYPES);
  }
}

const boardEl = document.querySelector("#board");
const statusText = document.querySelector("#statusText");
const roundCount = document.querySelector("#roundCount");
const humanCities = document.querySelector("#humanCities");
const aiCities = document.querySelector("#aiCities");
const aiLessons = document.querySelector("#aiLessons");
const brainStats = document.querySelector("#brainStats");
const trainProgress = document.querySelector("#trainProgress");
const endTurnBtn = document.querySelector("#endTurnBtn");
const newGameBtn = document.querySelector("#newGameBtn");
const livePauseBtn = document.querySelector("#livePauseBtn");
const humanVsHumanBtn = document.querySelector("#humanVsHumanBtn");
const trainBtn = document.querySelector("#trainBtn");
const resetBrainBtn = document.querySelector("#resetBrainBtn");
const demoAiBtn = document.querySelector("#demoAiBtn");
const trainCountInput = document.querySelector("#trainCountInput");
const demoTempoInput = document.querySelector("#demoTempoInput");
const rulesBtn = document.querySelector("#rulesBtn");
const rulesModal = document.querySelector("#rulesModal");
const rulesCloseBtn = document.querySelector("#rulesCloseBtn");
const productionModal = document.querySelector("#productionModal");
const productionCloseBtn = document.querySelector("#productionCloseBtn");
const productionTitle = document.querySelector("#productionTitle");
const productionCityText = document.querySelector("#productionCityText");
const productionOptions = document.querySelector("#productionOptions");
const victoryOverlay = document.querySelector("#victoryOverlay");
const victoryKicker = document.querySelector("#victoryKicker");
const victoryTitle = document.querySelector("#victoryTitle");
const victoryDetail = document.querySelector("#victoryDetail");
const victoryNewGameBtn = document.querySelector("#victoryNewGameBtn");
const starField = document.querySelector("#starField");

let state;
let selectedArmyId = null;
let isAnimating = false;
let audioContext = null;
let audioUnlocked = false;
let gameToken = 0;
let aiTurnTimer = null;
let demoRunning = false;
let trainingRunning = false;
let humanVsHuman = false;
let livePlayPaused = false;
let productionCityId = null;
let cityClickTimer = null;

function makeMap() {
  return window.EmpireMap.makeMap({ directions, inBounds, key, rand, shuffle, size: SIZE });
}

function landCells(terrain) {
  return window.EmpireMap.landCells(terrain);
}

function makeCity(id, x, y, owner) {
  const nextUnitType = producedUnitType();
  return {
    id,
    x,
    y,
    owner,
    produce: unitProductionTurns(nextUnitType),
    nextUnitType,
    garrison: [],
  };
}

function placeCities(terrain) {
  return window.EmpireMap.placeCities({
    cityCount: CITY_COUNT,
    distance,
    farEnough,
    makeCity,
    minimumCityDistance: SIZE <= 15 ? 2 : 3,
    shuffle,
    size: SIZE,
    terrain,
  });
}

function unitMaxHp(unit) {
  return UNIT_TYPES[unit.type]?.hp || UNIT_TYPES.infantry.hp;
}

function unitMoveRange(unit) {
  return UNIT_TYPES[unit.type]?.move || UNIT_TYPES.infantry.move;
}

function unitStrikePower(unit) {
  return UNIT_TYPES[unit.type]?.strike || UNIT_TYPES.infantry.strike;
}

function unitProductionTurns(type) {
  return UNIT_TYPES[type]?.productionTurns || UNIT_TYPES.infantry.productionTurns;
}

function unitLabel(unit) {
  return UNIT_TYPES[unit.type]?.label || UNIT_TYPES.infantry.label;
}

function unitLabelWithArticle(unit) {
  const label = unitLabel(unit);
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

function cityProductionText(city) {
  const type = city.nextUnitType || "infantry";
  const turnsLeft = city.produce;
  const totalTurns = unitProductionTurns(type);
  const completedTurns = Math.max(0, totalTurns - turnsLeft);
  const progress = completedTurns > 0 ? `, ${completedTurns} completed` : "";
  const garrison = city.garrison?.length
    ? `, inside: ${city.garrison.map((unit) => unitLabel(unit)).join(", ")}`
    : "";
  return `${city.owner} city, producing ${unitLabel({ type })}, ${turnsLeft} turn${
    turnsLeft === 1 ? "" : "s"
  } left of ${totalTurns}${progress}${garrison}`;
}

function armyTitleText(army) {
  if (army.type === "transport") {
    return `${army.owner} ${unitLabel(army)}, ${army.hp} HP, cargo ${transportCargoUsed(army)} / ${TRANSPORT_CAPACITY}`;
  }
  if (Number.isFinite(army.fuel)) {
    return `${army.owner} ${unitLabel(army)}, ${army.hp} HP, fuel ${army.fuel} / ${UNIT_TYPES[army.type]?.fuel}`;
  }
  return `${army.owner} ${unitLabel(army)}, ${army.hp} HP`;
}

function isFighter(unit) {
  return unit.type === "fighter";
}

function maxFuel(unit) {
  return UNIT_TYPES[unit.type]?.fuel;
}

function hasFuel(unit) {
  return Number.isFinite(unit.fuel) && Number.isFinite(maxFuel(unit));
}

function cargoSize(unit) {
  if (Number.isFinite(UNIT_TYPES[unit.type]?.cargoSize)) return UNIT_TYPES[unit.type].cargoSize;
  if (unit.type === "tank" || unit.type === "amphibious") return 2;
  if (unit.type === "infantry") return 1;
  return TRANSPORT_CAPACITY + 1;
}

function transportCargoUsed(transport) {
  return (transport.cargo || []).reduce((sum, unit) => sum + cargoSize(unit), 0);
}

function canBoardTransport(unit, transport) {
  return (
    transport?.type === "transport" &&
    transport.owner === unit.owner &&
    cargoSize(unit) <= TRANSPORT_CAPACITY &&
    transportCargoUsed(transport) + cargoSize(unit) <= TRANSPORT_CAPACITY
  );
}

function canMoveOntoTransport(unit, transport) {
  if (!canBoardTransport(unit, transport)) return false;
  return isLandCombatUnit(unit) ? distance(unit, transport) <= 1 : distance(unit, transport) <= unitMoveRange(unit);
}

function canUnloadTransport(transport, target, currentState = state) {
  if (transport.type !== "transport" || !transport.cargo?.length) return false;
  if (distance(transport, target) > 1) return false;
  if (!inBounds(target.x, target.y)) return false;
  if (currentState.terrain[target.y][target.x] !== "land") return false;
  return !currentState.armies.some((unit) => unit.x === target.x && unit.y === target.y);
}

function canEnterTerrain(unit, terrain) {
  const movement = UNIT_TYPES[unit.type]?.terrain || UNIT_TYPES.infantry.terrain;
  if (movement === "air") return true;
  if (movement === "amphibious") return terrain === "land" || terrain === "water";
  return terrain === movement;
}

function canEnterCell(unit, x, y, currentState = state) {
  const city = currentState.cities.find((item) => item.x === x && item.y === y);
  if (city?.owner === unit.owner && UNIT_TYPES[unit.type]?.canEnterCity) return true;
  return canEnterTerrain(unit, currentState.terrain[y][x]);
}

function isLandCombatUnit(unit) {
  return unit.type === "infantry" || unit.type === "tank" || unit.type === "amphibious";
}

function canConquerCity(unit) {
  return isLandCombatUnit(unit);
}

function isShip(unit) {
  return unit?.type === "transport" || unit?.type === "destroyer";
}

function canShoreAttack(unit, target, currentState = state) {
  if (!isLandCombatUnit(unit)) return false;
  if (distance(unit, target) > 1) return false;
  if (!inBounds(target.x, target.y)) return false;
  if (currentState.terrain[unit.y][unit.x] !== "land") return false;
  if (currentState.terrain[target.y][target.x] !== "water") return false;
  const defender = currentState.armies.find(
    (army) => army.x === target.x && army.y === target.y && army.owner !== unit.owner,
  );
  return isShip(defender);
}

function producedUnitType() {
  return PRODUCTION_POOL[rand(PRODUCTION_POOL.length)] || "infantry";
}

function makeUnit(owner, x, y, type = "infantry") {
  return {
    id: `${owner}-${crypto.randomUUID()}`,
    owner,
    type,
    x,
    y,
    hp: UNIT_TYPES[type]?.hp || UNIT_TYPES.infantry.hp,
    fuel: UNIT_TYPES[type]?.fuel,
    cargo: type === "transport" ? [] : undefined,
    acted: false,
  };
}

function nearbyLand(terrain, origin, count) {
  const cells = landCells(terrain)
    .filter((cell) => distance(cell, origin) <= 2)
    .sort((a, b) => distance(a, origin) - distance(b, origin));
  return cells.slice(0, count);
}

function newGame(options = {}) {
  gameToken += 1;
  livePlayPaused = false;
  if (!options.keepDemoRunning) {
    demoRunning = false;
    trainingRunning = false;
    humanVsHuman = !!options.humanVsHuman;
    setDemoControlsEnabled(true);
    setTrainingControlsEnabled(true);
  }
  if (aiTurnTimer) {
    clearTimeout(aiTurnTimer);
    aiTurnTimer = null;
  }
  isAnimating = false;
  document.querySelectorAll(".army-flyer, .crash-explosion, .production-burst").forEach((effect) => effect.remove());
  const terrain = makeMap();
  const cities = placeCities(terrain);
  const humanStart = cities.find((city) => city.owner === "human");
  const aiStart = cities.find((city) => city.owner === "ai");
  const humanStartCells = nearbyLand(terrain, humanStart, START_ARMIES + START_TANKS);
  const aiStartCells = nearbyLand(terrain, aiStart, START_ARMIES + START_TANKS);
  const armies = [
    ...humanStartCells.slice(0, START_TANKS).map((cell) => makeUnit("human", cell.x, cell.y, "tank")),
    ...humanStartCells.slice(START_TANKS).map((cell) => makeUnit("human", cell.x, cell.y)),
    ...aiStartCells.slice(0, START_TANKS).map((cell) => makeUnit("ai", cell.x, cell.y, "tank")),
    ...aiStartCells.slice(START_TANKS).map((cell) => makeUnit("ai", cell.x, cell.y)),
  ];

  state = {
    terrain,
    cities,
    armies,
    round: 1,
    phase: "human",
    gameOver: false,
    winner: null,
    victoryAnnounced: false,
    recordResults: true,
    humanVsHuman,
    demo: !!options.demo,
    skippedArmyIds: [],
    aiMemory: [],
    log: options.demo
      ? "Demo AI vs AI training starts."
      : humanVsHuman
      ? "Human vs Human. Blue player moves first."
      : "Move the flashing unit.",
  };
  selectedArmyId = null;
  hideVictoryMessage();
  render();
}

function startNewGame() {
  unlockAudio();
  newGame();
}

function startHumanVsHumanGame() {
  unlockAudio();
  newGame({ humanVsHuman: true });
}

window.startNewGame = startNewGame;

function cityAt(x, y) {
  return state.cities.find((city) => city.x === x && city.y === y);
}

function armyAt(x, y) {
  return state.armies.find((army) => army.x === x && army.y === y);
}

function armiesFor(owner) {
  return state.armies.filter((army) => army.owner === owner);
}

function citiesFor(owner) {
  return state.cities.filter((city) => city.owner === owner);
}

function transportersFor(owner) {
  return armiesFor(owner).filter((army) => army.type === "transport");
}

function usableTransportersFor(owner) {
  return transportersFor(owner).filter((transport) => legalMoves(transport).length > 0);
}

function activeUnitsFor(owner) {
  return armiesFor(owner).filter((army) => army.type !== "transport").concat(usableTransportersFor(owner));
}

function cityConquerorsFor(owner) {
  const deployed = armiesFor(owner).filter(canConquerCity);
  const cargo = transportersFor(owner).flatMap((transport) => (transport.cargo || []).filter(canConquerCity));
  return deployed.concat(cargo);
}

function activePlayerOwner() {
  return state.phase === "ai" ? "ai" : "human";
}

function sideName(owner) {
  return owner === "human" ? "Blue" : "Red";
}

function opponentOwner(owner) {
  return owner === "human" ? "ai" : "human";
}

function canTravelPath(unit, target, currentState = state) {
  const movement = UNIT_TYPES[unit.type]?.terrain || UNIT_TYPES.infantry.terrain;
  if (movement !== "land" && movement !== "amphibious") return true;
  if (!canEnterCell(unit, target.x, target.y, currentState)) return false;

  const maxSteps = unitMoveRange(unit);
  const startKey = key(unit.x, unit.y);
  const targetKey = key(target.x, target.y);
  const queue = [{ x: unit.x, y: unit.y, cost: 0 }];
  const bestCost = new Map([[startKey, 0]]);

  while (queue.length) {
    const current = queue.shift();
    if (key(current.x, current.y) === targetKey) return true;
    if (current.cost >= maxSteps) continue;

    for (const dir of directions) {
      const x = current.x + dir.dx;
      const y = current.y + dir.dy;
      const cellKey = key(x, y);
      if (!inBounds(x, y)) continue;
      const terrain = currentState.terrain[y][x];
      if (!canEnterCell(unit, x, y, currentState)) continue;
      const stepCost = movement === "amphibious" && terrain === "water" ? 2 : 1;
      const cost = current.cost + stepCost;
      if (cost > maxSteps || cost >= (bestCost.get(cellKey) ?? Infinity)) continue;
      bestCost.set(cellKey, cost);
      queue.push({ x, y, cost });
    }
  }
  return false;
}

function legalMoves(army, currentState = state) {
  const moves = [];
  const moveKeys = new Set();
  const range = unitMoveRange(army);
  const addMove = (move) => {
    const moveKey = key(move.x, move.y);
    if (moveKeys.has(moveKey)) return;
    moveKeys.add(moveKey);
    moves.push(move);
  };

  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > range) continue;
      const move = { x: army.x + dx, y: army.y + dy };
      if (!inBounds(move.x, move.y)) continue;
      if (hasFuel(army) && distance(army, move) > army.fuel) continue;
      const occupant = currentState.armies.find((unit) => unit.x === move.x && unit.y === move.y);
      if (occupant?.owner === army.owner) {
        if (canMoveOntoTransport(army, occupant)) addMove(move);
        continue;
      }
      if (canShoreAttack(army, move, currentState)) {
        addMove(move);
        continue;
      }
      if (canUnloadTransport(army, move, currentState)) {
        addMove(move);
        continue;
      }
      if (!canEnterCell(army, move.x, move.y, currentState)) continue;
      if (!canTravelPath(army, move, currentState)) continue;
      addMove(move);
    }
  }

  currentState.armies
    .filter((unit) => canMoveOntoTransport(army, unit))
    .forEach((transport) => addMove({ x: transport.x, y: transport.y }));

  return moves;
}

function resolveBattle(attacker, defender) {
  const attackerType = attacker.type;
  const defenderType = defender.type;
  const defenderCargo = defender.type === "transport" ? defender.cargo?.length || 0 : 0;
  while (attacker.hp > 0 && defender.hp > 0) {
    if (Math.random() < 0.5) defender.hp -= unitStrikePower(attacker);
    else attacker.hp -= unitStrikePower(defender);
  }

  const loser = attacker.hp <= 0 ? attacker : defender;
  const winner = loser === attacker ? defender : attacker;
  const cargoDestroyed = loser === defender ? defenderCargo : 0;
  state.armies = state.armies.filter((army) => army.id !== loser.id);
  winner.hp = Math.max(1, winner.hp);
  return { winner, loser, attackerType, defenderType, cargoDestroyed };
}

function resolveCityGarrisonDefense(attacker, city) {
  const defender = city.garrison?.[0];
  if (!defender || defender.owner === attacker.owner) {
    return { defended: false, city, remaining: city.garrison?.length || 0 };
  }

  const battle = resolveBattle(attacker, defender);
  if (battle.loser.id === defender.id) city.garrison.shift();
  return {
    defended: true,
    battle,
    city,
    remaining: city.garrison?.length || 0,
  };
}

function resolveShoreAttack(attacker, defender) {
  const attackerType = attacker.type;
  const defenderType = defender.type;
  defender.hp -= unitStrikePower(attacker);
  if (defender.hp > 0) {
    return { attackerType, defenderType, damaged: true, damage: unitStrikePower(attacker), cargoDestroyed: 0 };
  }

  const cargoDestroyed = defender.type === "transport" ? defender.cargo?.length || 0 : 0;
  state.armies = state.armies.filter((army) => army.id !== defender.id);
  return { winner: attacker, loser: defender, attackerType, defenderType, damage: unitStrikePower(attacker), cargoDestroyed };
}

function captureCity(army) {
  if (!canConquerCity(army)) return false;
  const city = cityAt(army.x, army.y);
  if (city && city.owner !== army.owner) {
    city.owner = army.owner;
    city.garrison = [];
    city.manualProduction = false;
    city.nextUnitType = chooseProductionType(army.owner);
    city.produce = unitProductionTurns(city.nextUnitType);
    return true;
  }
  return false;
}

function cityReleaseCell(city, unit) {
  if (!armyAt(city.x, city.y) && canEnterCell(unit, city.x, city.y)) return city;
  return directions
    .map((dir) => ({ x: city.x + dir.dx, y: city.y + dir.dy }))
    .find(
      (cell) =>
        inBounds(cell.x, cell.y) &&
        !armyAt(cell.x, cell.y) &&
        canEnterCell(unit, cell.x, cell.y),
    );
}

function releaseCityGarrison(city) {
  if (!city.garrison?.length) return { released: false, city };
  const unit = city.garrison[0];
  const releaseCell = cityReleaseCell(city, unit);
  if (!releaseCell) return { released: false, city, type: unit.type };
  city.garrison.shift();
  state.armies.push({ ...unit, x: releaseCell.x, y: releaseCell.y, acted: true, insideCity: false });
  return { released: true, city, type: unit.type };
}

function releaseCityGarrisons() {
  const releases = [];
  for (const city of state.cities) {
    const release = releaseCityGarrison(city);
    if (release.released) releases.push(release);
  }
  return releases;
}

function produceCityUnit(city) {
  const type = city.nextUnitType || "infantry";
  const unit = { ...makeUnit(city.owner, null, null, type), acted: true, insideCity: true };
  city.garrison = [...(city.garrison || []), unit];
  city.nextUnitType = city.manualProduction && !ownerUsesAiProduction(city.owner) ? type : chooseProductionType(city.owner);
  city.produce = unitProductionTurns(city.nextUnitType || "infantry");
  return { produced: true, type, spawn: { x: city.x, y: city.y }, city, insideCity: true };
}

function boostCityProduction(unit) {
  if (!isFighter(unit)) return null;
  const city = cityAt(unit.x, unit.y);
  if (!city || city.owner !== unit.owner || city.produce <= 0) return null;
  const before = city.produce;
  const amount = Math.min(before, unitStrikePower(unit));
  city.produce -= amount;
  const completed = city.produce <= 0 ? produceCityUnit(city) : null;
  if (completed && !completed.produced) city.produce = 1;
  return { city, amount, before, completed };
}

function serviceFuel(unit, fuelCost) {
  if (!hasFuel(unit)) return { destroyed: false, refueled: false };
  const city = cityAt(unit.x, unit.y);
  if (city?.owner === unit.owner) {
    unit.fuel = maxFuel(unit);
    return { destroyed: false, refueled: true };
  }
  unit.fuel -= fuelCost;
  if (unit.fuel <= 0) {
    const destroyedAt = { x: unit.x, y: unit.y };
    state.armies = state.armies.filter((army) => army.id !== unit.id);
    return { destroyed: true, refueled: false, destroyedAt };
  }
  return { destroyed: false, refueled: false };
}

function moveArmy(army, target) {
  const fuelCost = distance(army, target);
  const defender = armyAt(target.x, target.y);
  const targetCity = cityAt(target.x, target.y);
  if (canMoveOntoTransport(army, defender)) {
    defender.cargo = [...(defender.cargo || []), { ...army, x: null, y: null, acted: true, insideTransport: true }];
    state.armies = state.armies.filter((unit) => unit.id !== army.id);
    return { moved: false, captured: false, boarded: true, transport: defender };
  }

  if (canUnloadTransport(army, target)) {
    const { insideTransport, ...cargoUnit } = army.cargo.shift();
    const unloadedUnit = { ...cargoUnit, x: target.x, y: target.y, acted: true };
    army.acted = true;
    if (targetCity?.owner && targetCity.owner !== unloadedUnit.owner && targetCity.garrison?.length) {
      state.armies.push(unloadedUnit);
      const cityDefense = resolveCityGarrisonDefense(unloadedUnit, targetCity);
      if (state.armies.includes(unloadedUnit)) {
        state.armies = state.armies.filter((unit) => unit.id !== unloadedUnit.id);
        if (!cityDefense.remaining) {
          state.armies.push(unloadedUnit);
          const captured = captureCity(unloadedUnit);
          const capturedCity = captured ? cityAt(target.x, target.y) : null;
          return { moved: false, captured, capturedCity, unloaded: true, transport: army, unit: unloadedUnit, cityDefense, battle: cityDefense.battle };
        }
        army.cargo.unshift({ ...unloadedUnit, x: null, y: null, acted: true, insideTransport: true });
      }
      return { moved: false, captured: false, unloaded: true, transport: army, unit: unloadedUnit, cityDefense, battle: cityDefense.battle };
    }

    state.armies.push(unloadedUnit);
    const captured = captureCity(unloadedUnit);
    const capturedCity = captured ? cityAt(target.x, target.y) : null;
    return { moved: false, captured, capturedCity, unloaded: true, transport: army, unit: unloadedUnit };
  }

  let battle = null;
  if (defender && defender.owner !== army.owner) {
    if (canShoreAttack(army, target)) {
      battle = resolveShoreAttack(army, defender);
      army.acted = true;
      return { moved: false, captured: false, battle, shoreAttack: true };
    }
    battle = resolveBattle(army, defender);
    if (!state.armies.includes(army)) return { moved: false, captured: false, battle };
    if (targetCity?.owner && targetCity.owner !== army.owner && targetCity.garrison?.length) {
      army.acted = true;
      return { moved: false, captured: false, battle, cityHeld: true };
    }
  }

  if (targetCity?.owner && targetCity.owner !== army.owner && targetCity.garrison?.length) {
    const cityDefense = resolveCityGarrisonDefense(army, targetCity);
    army.acted = true;
    if (!state.armies.includes(army) || cityDefense.remaining) {
      return { moved: false, captured: false, cityDefense, battle: cityDefense.battle };
    }
  }

  army.x = target.x;
  army.y = target.y;
  army.acted = true;
  const captured = captureCity(army);
  const productionBoost = boostCityProduction(army);
  const fuel = serviceFuel(army, fuelCost);
  return { moved: true, captured, battle, fuel, productionBoost };
}

function getCellElement(x, y) {
  return boardEl.querySelector(`[data-x="${x}"][data-y="${y}"]`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLivePlay(ms, token = gameToken) {
  await wait(ms);
  while (livePlayPaused && token === gameToken && !state.gameOver && !trainingRunning) {
    render();
    await wait(150);
  }
  return token === gameToken && !state.gameOver;
}

async function animateArmyMove(army, target) {
  const fromCell = getCellElement(army.x, army.y);
  const toCell = getCellElement(target.x, target.y);
  const sourceArmy = fromCell?.querySelector(".army");
  if (!fromCell || !toCell || !sourceArmy) return;

  const fromRect = fromCell.getBoundingClientRect();
  const toRect = toCell.getBoundingClientRect();
  const armyRect = sourceArmy.getBoundingClientRect();
  const flyer = sourceArmy.cloneNode(true);
  const originalVisibility = sourceArmy.style.visibility;
  sourceArmy.style.visibility = "hidden";

  flyer.classList.remove("ready-army");
  flyer.classList.add("army-flyer");
  flyer.style.left = `${armyRect.left}px`;
  flyer.style.top = `${armyRect.top}px`;
  flyer.style.width = `${armyRect.width}px`;
  flyer.style.height = `${armyRect.height}px`;
  document.body.append(flyer);

  const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
  const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
  await wait(20);
  flyer.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
  await wait(260);
  flyer.remove();
  sourceArmy.style.visibility = originalVisibility;
}

function showCrashExplosion(x, y) {
  const cell = getCellElement(x, y);
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  const burst = document.createElement("span");
  burst.className = "crash-explosion";
  burst.style.left = `${rect.left + rect.width / 2}px`;
  burst.style.top = `${rect.top + rect.height / 2}px`;
  burst.style.width = `${Math.max(24, rect.width * 0.82)}px`;
  burst.style.height = `${Math.max(24, rect.height * 0.82)}px`;
  document.body.append(burst);
  window.setTimeout(() => burst.remove(), 720);
}

function showProductionBurst(city, type) {
  if (state.silent) return;
  const cell = getCellElement(city.x, city.y);
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  const burst = document.createElement("span");
  burst.className = "production-burst";
  burst.textContent = `${unitLabel({ type })} ready`;
  burst.style.left = `${rect.left + rect.width / 2}px`;
  burst.style.top = `${rect.top + rect.height / 2}px`;
  document.body.append(burst);
  window.setTimeout(() => burst.remove(), 1100);
}

function getAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) audioContext = new AudioCtor();
  return audioContext;
}

async function unlockAudio() {
  if (audioUnlocked) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    return;
  }

  const gain = ctx.createGain();
  const oscillator = ctx.createOscillator();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  oscillator.frequency.setValueAtTime(80, ctx.currentTime);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.02);
  audioUnlocked = true;
}

function playDrumHit(ctx, startTime, frequency, duration, volume) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(55, startTime + duration);
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function playSnareHit(ctx, startTime, duration, volume) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const noise = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(900, startTime);
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  noise.buffer = buffer;
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(startTime);
  noise.stop(startTime + duration);
}

function playBugleTone(ctx, startTime, frequency, duration, volume) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function playMetalClash(ctx, startTime, duration, volume) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    const fade = 1 - i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }

  const noise = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1850, startTime);
  filter.Q.setValueAtTime(7, startTime);
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  noise.buffer = buffer;
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(startTime);
  noise.stop(startTime + duration);
}

function playGunShot(ctx, startTime, volume = 0.12) {
  const bufferSize = Math.floor(ctx.sampleRate * 0.035);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    const fade = 1 - i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * fade;
  }

  const noise = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(1800, startTime);
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.035);
  noise.buffer = buffer;
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(startTime);
  noise.stop(startTime + 0.04);
}

function playMachineGunBurst(ctx, startTime, shots = 6, volume = 0.12) {
  for (let i = 0; i < shots; i += 1) {
    playGunShot(ctx, startTime + i * 0.045, volume * (0.85 + Math.random() * 0.3));
  }
}

function playArtilleryBlast(ctx, startTime, volume = 0.48) {
  playDrumHit(ctx, startTime, 72, 0.42, volume);
  playDrumHit(ctx, startTime + 0.08, 48, 0.34, volume * 0.58);
  playSnareHit(ctx, startTime + 0.035, 0.18, volume * 0.34);
  playMetalClash(ctx, startTime + 0.13, 0.22, volume * 0.28);
}

function playBattleSound(battle) {
  if (!battle) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().then(() => playBattleSound(battle));
    return;
  }

  const tankInvolved = battle.attackerType === "tank" || battle.defenderType === "tank";
  const now = ctx.currentTime + 0.02;
  if (tankInvolved) {
    playArtilleryBlast(ctx, now, 0.5);
    playMachineGunBurst(ctx, now + 0.12, 4, 0.08);
    return;
  }

  playMachineGunBurst(ctx, now, 7, 0.13);
  playMetalClash(ctx, now + 0.12, 0.1, 0.12);
}

function playCrashExplosionSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().then(playCrashExplosionSound);
    return;
  }

  const now = ctx.currentTime + 0.02;
  playArtilleryBlast(ctx, now, 0.54);
  playMachineGunBurst(ctx, now + 0.14, 3, 0.07);
  playMetalClash(ctx, now + 0.24, 0.22, 0.2);
}

function playCityCaptureSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().then(playCityCaptureSound);
    return;
  }

  const now = ctx.currentTime + 0.02;
  playArtilleryBlast(ctx, now, 0.42);
  playMachineGunBurst(ctx, now + 0.18, 5, 0.08);
}

function playCaptureFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().then(playCaptureFanfare);
    return;
  }
  const now = ctx.currentTime + 0.02;
  playDrumHit(ctx, now, 150, 0.22, 0.32);
  playSnareHit(ctx, now + 0.08, 0.1, 0.16);
  playDrumHit(ctx, now + 0.18, 125, 0.2, 0.28);
  playSnareHit(ctx, now + 0.27, 0.11, 0.18);
  playDrumHit(ctx, now + 0.36, 165, 0.28, 0.34);
  playBugleTone(ctx, now + 0.04, 392, 0.2, 0.08);
  playBugleTone(ctx, now + 0.2, 523.25, 0.22, 0.08);
  playBugleTone(ctx, now + 0.4, 659.25, 0.32, 0.07);
}

function playVictoryFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().then(playVictoryFanfare);
    return;
  }
  const now = ctx.currentTime + 0.03;
  playDrumHit(ctx, now, 145, 0.18, 0.34);
  playSnareHit(ctx, now + 0.1, 0.1, 0.18);
  playDrumHit(ctx, now + 0.22, 120, 0.2, 0.3);
  playSnareHit(ctx, now + 0.34, 0.11, 0.2);
  playDrumHit(ctx, now + 0.48, 170, 0.28, 0.36);
  playBugleTone(ctx, now + 0.06, 392, 0.22, 0.1);
  playBugleTone(ctx, now + 0.24, 523.25, 0.24, 0.1);
  playBugleTone(ctx, now + 0.44, 659.25, 0.28, 0.09);
  playBugleTone(ctx, now + 0.66, 783.99, 0.42, 0.08);
  playBugleTone(ctx, now + 0.68, 987.77, 0.38, 0.045);
}

function playTrainingFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().then(playTrainingFanfare);
    return;
  }
  const now = ctx.currentTime + 0.02;
  playDrumHit(ctx, now, 130, 0.14, 0.2);
  playBugleTone(ctx, now + 0.02, 523.25, 0.16, 0.07);
  playBugleTone(ctx, now + 0.16, 659.25, 0.18, 0.07);
  playBugleTone(ctx, now + 0.32, 783.99, 0.24, 0.065);
}

function playProductionFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().then(playProductionFanfare);
    return;
  }
  const now = ctx.currentTime + 0.02;
  playDrumHit(ctx, now, 118, 0.12, 0.18);
  playBugleTone(ctx, now + 0.04, 523.25, 0.13, 0.06);
  playBugleTone(ctx, now + 0.16, 659.25, 0.16, 0.055);
}

function hideVictoryMessage() {
  victoryOverlay.classList.remove("show");
  victoryOverlay.setAttribute("aria-hidden", "true");
  victoryOverlay.querySelector(".victory-message")?.classList.remove("training");
  starField.innerHTML = "";
}

function launchVictoryStars() {
  starField.innerHTML = "";
  for (let i = 0; i < 34; i += 1) {
    const star = document.createElement("span");
    star.className = "flying-star";
    star.style.setProperty("--star-left", `${rand(100)}%`);
    star.style.setProperty("--star-size", `${14 + rand(28)}px`);
    star.style.setProperty("--star-drift", `${-140 + rand(281)}px`);
    star.style.setProperty("--star-speed", `${1500 + rand(1300)}ms`);
    star.style.setProperty("--star-delay", `${rand(900)}ms`);
    starField.append(star);
  }
}

function showVictoryMessage(winner) {
  victoryOverlay.querySelector(".victory-message")?.classList.remove("training");
  victoryKicker.textContent = winner === "human" || state.humanVsHuman ? "Empire secured" : "Empire lost";
  victoryTitle.textContent = winner === "human" ? "Blue Victory" : state.humanVsHuman ? "Red Victory" : "Defeat";
  victoryDetail.textContent =
    winner === "human"
      ? "Red has no cities or army/tank units that can conquer cities left."
      : "Blue has no cities or army/tank units that can conquer cities left.";
  victoryOverlay.classList.add("show");
  victoryOverlay.setAttribute("aria-hidden", "false");
  launchVictoryStars();
  playVictoryFanfare();
}

function showTrainingDoneMessage(count) {
  victoryOverlay.querySelector(".victory-message")?.classList.add("training");
  victoryKicker.textContent = "AI training";
  victoryTitle.textContent = "Training has done";
  victoryDetail.textContent = `${count} / ${count} games trained in the background.`;
  victoryOverlay.classList.add("show");
  victoryOverlay.setAttribute("aria-hidden", "false");
  launchVictoryStars();
  playTrainingFanfare();
}

async function performVisibleMove(army, target) {
  const moveToken = arguments.length > 2 ? arguments[2] : gameToken;
  isAnimating = true;
  await animateArmyMove(army, target);
  if (moveToken !== gameToken) {
    isAnimating = false;
    return { cancelled: true };
  }
  const result = moveArmy(army, target);
  if (result.battle) playBattleSound(result.battle);
  if (result.captured) {
    playCityCaptureSound();
    window.setTimeout(playCaptureFanfare, 260);
  }
  if (result.fuel?.destroyed) {
    const destroyedAt = result.fuel.destroyedAt || target;
    showCrashExplosion(destroyedAt.x, destroyedAt.y);
    playCrashExplosionSound();
  }
  if (result.productionBoost?.completed?.produced) {
    announceProduction([result.productionBoost.completed]);
  }
  isAnimating = false;
  return result;
}

function readyArmiesFor(owner) {
  if (!["human", "ai"].includes(state.phase) || state.gameOver) return [];
  const ready = armiesFor(owner).filter((army) => !army.acted && legalMoves(army).length > 0);
  if (owner !== activePlayerOwner() || !state.skippedArmyIds?.length) return ready;

  const skippedIds = new Set(state.skippedArmyIds);
  const unskipped = ready.filter((army) => !skippedIds.has(army.id));
  if (unskipped.length) return unskipped;

  state.skippedArmyIds = [];
  return ready;
}

function allActiveArmiesActed() {
  const owner = activePlayerOwner();
  return armiesFor(owner).every((army) => army.acted || legalMoves(army).length === 0);
}

function readyActiveArmies() {
  return readyArmiesFor(activePlayerOwner());
}

function activateNextArmy() {
  if (!["human", "ai"].includes(state.phase) || state.gameOver) {
    selectedArmyId = null;
    return null;
  }

  const owner = activePlayerOwner();
  const selectedArmy = state.armies.find((army) => army.id === selectedArmyId);
  if (selectedArmy?.owner === owner && !selectedArmy.acted && legalMoves(selectedArmy).length > 0) {
    return selectedArmy;
  }

  const nextArmy = readyActiveArmies()[0] || null;
  selectedArmyId = nextArmy?.id || null;
  return nextArmy;
}

function beginAiTurn() {
  selectedArmyId = null;
  state.skippedArmyIds = [];
  state.phase = "ai";
  if (state.humanVsHuman) {
    state.log = "Red player turn. Move the flashing unit.";
    render();
    return;
  }
  state.log = "Red AI turn. Red is moving each unit once.";
  const turnToken = gameToken;
  render();
  if (!livePlayPaused) aiTurnTimer = setTimeout(() => runAiTurn("ai", turnToken), 220);
}

function skipTurn() {
  if (trainingRunning || demoRunning || isAnimating || state.gameOver || !["human", "ai"].includes(state.phase)) return;
  if (livePlayPaused) return;
  if (!state.humanVsHuman && state.phase !== "human") return;
  const owner = activePlayerOwner();

  armiesFor(owner).forEach((army) => {
    army.acted = true;
  });
  state.skippedArmyIds = [];
  selectedArmyId = null;
  state.log = `${sideName(owner)} skipped the turn.`;
  finishActiveTurnAfterMove();
}

function skipActiveUnit() {
  if (trainingRunning || demoRunning || isAnimating || state.gameOver || !["human", "ai"].includes(state.phase)) return;
  if (livePlayPaused) return;
  if (!state.humanVsHuman && state.phase !== "human") return;
  const owner = activePlayerOwner();
  const activeArmy = activateNextArmy();
  if (!activeArmy) return;

  activeArmy.acted = true;
  state.skippedArmyIds = [];
  selectedArmyId = null;

  if (allActiveArmiesActed()) {
    state.log = `${sideName(owner)} skipped ${unitLabel(activeArmy)}.`;
    finishActiveTurnAfterMove();
    return;
  }

  const nextArmy = activateNextArmy();
  state.log = `${sideName(owner)} skipped ${unitLabel(activeArmy)}. ${unitLabel(nextArmy)} is active.`;
  render();
}

function pauseLivePlay() {
  if (state.gameOver || trainingRunning || livePlayPaused) return;
  livePlayPaused = true;
  if (aiTurnTimer) {
    clearTimeout(aiTurnTimer);
    aiTurnTimer = null;
  }
  selectedArmyId = null;
  state.log = "Live play stopped. Continue Live Play resumes this same game.";
  render();
}

function continueLivePlay() {
  if (state.gameOver || trainingRunning || !livePlayPaused) return;
  livePlayPaused = false;
  state.log = "Live play continues.";
  render();
  if (!demoRunning && !state.humanVsHuman && state.phase === "ai") {
    aiTurnTimer = setTimeout(() => runAiTurn("ai", gameToken), 180);
  }
}

function toggleLivePlay() {
  unlockAudio();
  if (livePlayPaused) continueLivePlay();
  else pauseLivePlay();
}

function finishRound() {
  state.skippedArmyIds = [];
  releaseCityGarrisons();
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
  if (!state.gameOver && allActiveArmiesActed()) {
    beginAiTurn();
    return;
  }
  activateNextArmy();
  render();
}

function announceProduction(events) {
  const producedEvents = events.filter((event) => event.produced);
  if (!producedEvents.length || state.silent) return;

  for (const event of producedEvents) {
    showProductionBurst(event.city, event.type);
  }
  playProductionFanfare();

  const names = producedEvents.map((event) => `${sideName(event.city.owner)} ${unitLabel({ type: event.type })}`);
  state.log =
    names.length === 1
      ? `${names[0]} produced in city ${producedEvents[0].city.x + 1}, ${producedEvents[0].city.y + 1}.`
      : `${names.length} units produced: ${names.join(", ")}.`;
}

function produceArmies() {
  const productionEvents = [];
  for (const city of state.cities) {
    if (city.owner === "neutral") continue;
    city.produce -= 1;
    if (city.produce > 0) continue;
    const result = produceCityUnit(city);
    if (!result.produced) {
      city.produce = 1;
    } else {
      productionEvents.push(result);
    }
  }
  announceProduction(productionEvents);
  releaseCityGarrisons();
  return productionEvents;
}

function checkVictory() {
  if (state.gameOver) return;
  const humanWon = cityConquerorsFor("ai").length === 0 && citiesFor("ai").length === 0;
  const aiWon = cityConquerorsFor("human").length === 0 && citiesFor("human").length === 0;

  if (humanWon) {
    state.gameOver = true;
    state.winner = "human";
    state.log = "You win. Red has no cities or army/tank units that can conquer cities left.";
    if (state.humanVsHuman) {
      state.log = "Blue wins. Red has no cities or army/tank units that can conquer cities left.";
    } else {
      learnFromGame(false, { recordResult: state.recordResults !== false });
    }
  } else if (aiWon) {
    state.gameOver = true;
    state.winner = "ai";
    state.log = `${state.humanVsHuman ? "Red wins" : "AI wins"}. Blue has no cities or army/tank units that can conquer cities left.`;
    if (state.humanVsHuman) {
      state.log = "Red wins. Blue has no cities or army/tank units that can conquer cities left.";
    } else {
      learnFromGame(true, { recordResult: state.recordResults !== false });
    }
  }

  if (state.gameOver && !state.victoryAnnounced && !state.silent) {
    state.victoryAnnounced = true;
    showVictoryMessage(state.winner);
  }
}

function productionStatsText(type) {
  const unit = UNIT_TYPES[type];
  const fuel = Number.isFinite(unit.fuel) ? `, fuel ${unit.fuel}` : "";
  return `${unit.hp} HP, move ${unit.move}, strike ${unit.strike}${fuel}`;
}

function productionUnitEntries() {
  const ordered = PRODUCTION_ORDER.filter((type) => UNIT_TYPES[type]).map((type) => [type, UNIT_TYPES[type]]);
  const orderedTypes = new Set(ordered.map(([type]) => type));
  return ordered.concat(Object.entries(UNIT_TYPES).filter(([type]) => !orderedTypes.has(type)));
}

function selectedProductionCity(cityId = productionCityId) {
  return state.cities.find((city) => city.id === cityId) || null;
}

function showProductionModal(city) {
  if (!city || city.owner !== activePlayerOwner()) return;
  productionCityId = city.id;
  productionTitle.textContent = "What unit city is going to produce?";
  productionCityText.textContent = `This ${sideName(city.owner).toLowerCase()} city will produce ${unitLabel({
    type: city.nextUnitType || "infantry",
  })} in ${city.produce} turn${city.produce === 1 ? "" : "s"}.`;
  productionOptions.replaceChildren(
    ...productionUnitEntries().map(([type, unit]) => {
      const button = document.createElement("button");
      button.className = `production-option${type === (city.nextUnitType || "infantry") ? " selected" : ""}`;
      button.type = "button";
      button.dataset.unitType = type;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        chooseHumanProduction(type, city.id);
      });

      const label = document.createElement("strong");
      label.textContent = unit.label;
      const stats = document.createElement("span");
      stats.textContent = productionStatsText(type);
      button.append(label, stats);
      return button;
    }),
  );
  productionModal.classList.add("show");
  productionModal.setAttribute("aria-hidden", "false");
  productionOptions.querySelector(`[data-unit-type="${city.nextUnitType || "infantry"}"]`)?.focus();
}

function hideProductionModal(options = {}) {
  productionModal.classList.remove("show");
  productionModal.setAttribute("aria-hidden", "true");
  productionCityId = null;
  if (options.continueTurn) continueHumanTurnAfterProductionChoice();
}

function continueHumanTurnAfterProductionChoice() {
  if (state.gameOver || !["human", "ai"].includes(state.phase)) return;
  if (allActiveArmiesActed()) {
    if (state.humanVsHuman && state.phase === "ai") finishRound();
    else beginAiTurn();
    return;
  }
  activateNextArmy();
  render();
}

function finishActiveTurnAfterMove() {
  if (state.humanVsHuman && state.phase === "ai") {
    finishRound();
    return;
  }
  if (state.phase === "human") {
    beginAiTurn();
    return;
  }
  render();
}

function chooseHumanProduction(type, cityId = productionCityId) {
  const city = selectedProductionCity(cityId);
  if (!city || !UNIT_TYPES[type]) {
    hideProductionModal({ continueTurn: true });
    return;
  }
  city.nextUnitType = type;
  city.manualProduction = true;
  city.produce = unitProductionTurns(type);
  state.log = `${sideName(city.owner)} city at ${city.x + 1}, ${city.y + 1} will produce ${unitLabel({ type })}.`;
  hideProductionModal({ continueTurn: true });
}

function clearCityClickTimer() {
  if (!cityClickTimer) return;
  window.clearTimeout(cityClickTimer.timer);
  cityClickTimer = null;
}

function scheduleFriendlyCityClick(x, y, owner) {
  const pending = cityClickTimer;
  if (pending && pending.x === x && pending.y === y && pending.owner === owner) {
    clearCityClickTimer();
    const city = cityAt(x, y);
    if (city?.owner === owner) showProductionModal(city);
    return;
  }

  clearCityClickTimer();
  cityClickTimer = {
    x,
    y,
    owner,
    timer: window.setTimeout(() => {
      cityClickTimer = null;
      handleCellClick(x, y, { skipFriendlyCityDoubleClick: true });
    }, CITY_PRODUCTION_DOUBLE_CLICK_MS),
  };
}

async function handleCellClick(x, y, options = {}) {
  if (
    trainingRunning ||
    demoRunning ||
    isAnimating ||
    livePlayPaused ||
    state.gameOver ||
    !["human", "ai"].includes(state.phase) ||
    (!state.humanVsHuman && state.phase !== "human") ||
    productionModal.classList.contains("show")
  ) {
    return;
  }
  unlockAudio();
  const currentOwner = activePlayerOwner();
  const clickedArmy = armyAt(x, y);
  const clickedCity = cityAt(x, y);
  const activeArmy = activateNextArmy();
  if (
    cityClickTimer &&
    !options.skipFriendlyCityDoubleClick &&
    (cityClickTimer.x !== x || cityClickTimer.y !== y || clickedCity?.owner !== currentOwner)
  ) {
    clearCityClickTimer();
  }
  const activeCanMoveToClicked =
    activeArmy &&
    (activeArmy.x !== x || activeArmy.y !== y) &&
    legalMoves(activeArmy).some((move) => move.x === x && move.y === y);

  if (clickedCity?.owner === currentOwner && !options.skipFriendlyCityDoubleClick) {
    scheduleFriendlyCityClick(x, y, currentOwner);
    return;
  }

  if (clickedCity?.owner === currentOwner && !activeCanMoveToClicked) {
    state.log = `Double-click the city to change production.`;
    render();
    return;
  }

  if (clickedArmy?.owner === currentOwner && clickedArmy.id !== activeArmy?.id && !activeCanMoveToClicked && !clickedArmy.acted) {
    selectedArmyId = clickedArmy.id;
    state.log = `${sideName(currentOwner)}: move the flashing unit to a highlighted square, city, or enemy.`;
    render();
    return;
  }

  const army = activeArmy;
  if (!army || army.acted) return;
  const legal = legalMoves(army).some((move) => move.x === x && move.y === y);
  if (!legal) {
    state.log = "That unit can move to a highlighted square, but not into water or your own unit.";
    render();
    return;
  }

  const result = await performVisibleMove(army, { x, y });
  if (result.cancelled) {
    render();
    return;
  }
  selectedArmyId = null;
  const capturedCity = result.captured ? result.capturedCity || cityAt(army.x, army.y) : null;
  if (result.fuel?.destroyed) state.log = `${unitLabel(army)} ran out of fuel and was destroyed.`;
  else if (result.shoreAttack && result.battle?.loser?.owner === opponentOwner(currentOwner)) {
    const cargoText = result.battle.cargoDestroyed
      ? ` Cargo ${result.battle.cargoDestroyed} unit${result.battle.cargoDestroyed === 1 ? "" : "s"} destroyed.`
      : "";
    state.log = `${sideName(currentOwner)} shore attack destroyed the enemy ${unitLabel({
      type: result.battle.defenderType,
    })}.${cargoText}`;
  }
  else if (result.shoreAttack && result.battle?.loser?.owner === currentOwner) state.log = `${sideName(currentOwner)} unit was destroyed attacking a ship.`;
  else if (result.shoreAttack) state.log = `${sideName(currentOwner)} damaged the enemy ship from shore.`;
  else if (result.cityDefense?.battle?.loser?.owner === opponentOwner(currentOwner))
    state.log = result.cityDefense.remaining
      ? `${sideName(currentOwner)} destroyed one city defender. ${result.cityDefense.remaining} unit${
          result.cityDefense.remaining === 1 ? "" : "s"
        } still inside.`
      : `${sideName(currentOwner)} broke the city defense.`;
  else if (result.cityDefense?.battle?.loser?.owner === currentOwner)
    state.log = `${sideName(currentOwner)} unit was destroyed attacking city defenders.`;
  else if (result.cityHeld) state.log = `${sideName(currentOwner)} won the battle, but city units still defend inside.`;
  else if (result.battle?.loser.owner === opponentOwner(currentOwner)) state.log = `${sideName(currentOwner)} unit won the battle.`;
  else if (result.battle?.loser.owner === currentOwner) state.log = `${sideName(currentOwner)} unit was destroyed in battle.`;
  else if (result.unloaded && result.captured)
    state.log = `Transporter unloaded ${unitLabel(result.unit)} and captured a city. Choose what it will produce.`;
  else if (result.captured) state.log = `${sideName(currentOwner)} captured a city. Choose what it will produce.`;
  else if (result.boarded) state.log = `Unit boarded a transporter. Cargo ${transportCargoUsed(result.transport)} / ${TRANSPORT_CAPACITY}.`;
  else if (result.unloaded) state.log = `Transporter unloaded ${unitLabel(result.unit)}.`;
  else if (result.productionBoost?.completed?.produced)
    state.log = `Fighter sped up city production by ${result.productionBoost.amount} and produced ${unitLabel({
      type: result.productionBoost.completed.type,
    })}.`;
  else if (result.productionBoost)
    state.log = `Fighter sped up city production by ${result.productionBoost.amount} turn${
      result.productionBoost.amount === 1 ? "" : "s"
    }.`;
  else if (result.fuel?.refueled) state.log = `${unitLabel(army)} refueled in a friendly city.`;
  else state.log = "Unit moved.";

  checkVictory();
  if (!state.gameOver && capturedCity?.owner === currentOwner) {
    activateNextArmy();
    render();
    showProductionModal(capturedCity);
    return;
  }
  if (!state.gameOver && allActiveArmiesActed()) {
    finishActiveTurnAfterMove();
  } else {
    activateNextArmy();
    render();
  }
}

function render() {
  const activeArmy = demoRunning ? state.armies.find((army) => army.id === selectedArmyId) : activateNextArmy();
  livePauseBtn.textContent = livePlayPaused ? "Continue Live Play" : "Stop Live Play";
  livePauseBtn.disabled = trainingRunning || state.gameOver;
  roundCount.textContent = state.round;
  humanCities.textContent = citiesFor("human").length;
  aiCities.textContent = citiesFor("ai").length;
  aiLessons.textContent = brain.lessons;
  const readyCount = readyActiveArmies().length;
  const humanPrompt = state.log.includes("flashing unit") ? state.log : `${state.log} Move the flashing unit.`;
  statusText.textContent =
    livePlayPaused
      ? state.log
      : demoRunning
      ? state.log
      : state.log.startsWith("Training complete")
      ? state.log
      : !state.humanVsHuman && state.phase !== "human"
      ? state.log
      : ["human", "ai"].includes(state.phase) && !state.gameOver && readyCount > 0
      ? `${sideName(activePlayerOwner())}: ${humanPrompt} ${readyCount} unit${readyCount === 1 ? " is" : "s are"} ready.`
      : state.log;
  renderBrain();

  const selectedArmy = activeArmy;
  const readyArmyIds = new Set(readyActiveArmies().map((army) => army.id));
  const moveKeys = new Set(selectedArmy ? legalMoves(selectedArmy).map((move) => key(move.x, move.y)) : []);

  boardEl.innerHTML = "";
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.ariaLabel = `x ${x + 1}, y ${y + 1}`;
      if (state.terrain[y][x] === "water") cell.classList.add("water");

      const city = cityAt(x, y);
      const army = armyAt(x, y);
      const citySquareArmy = city && army?.owner === city.owner ? army : null;
      if (city) {
        cell.classList.add("city");
        if (city.owner === "human") cell.classList.add("human-city");
        if (city.owner === "ai") cell.classList.add("ai-city");
        const cityUnitCount = (city.garrison?.length || 0) + (citySquareArmy ? 1 : 0);
        if (cityUnitCount) {
          cell.classList.add("city-garrisoned");
          const garrisonMarker = document.createElement("span");
          garrisonMarker.className = "city-garrison";
          garrisonMarker.textContent = cityUnitCount;
          garrisonMarker.setAttribute("aria-hidden", "true");
          cell.append(garrisonMarker);
        }
        if (citySquareArmy && readyArmyIds.has(citySquareArmy.id)) cell.classList.add("ready-cell");
        if (citySquareArmy?.id === selectedArmy?.id) cell.classList.add("active-cell");
        cell.title = cityProductionText(city);
        cell.ariaLabel = `${cell.ariaLabel}, ${cityProductionText(city)}`;
        if (citySquareArmy) {
          const cityArmyTitle = armyTitleText(citySquareArmy);
          cell.title = `${cityProductionText(city)}\nInside: ${cityArmyTitle}`;
          cell.ariaLabel = `${cell.ariaLabel}, inside: ${cityArmyTitle}`;
        }
      }

      if (army && !citySquareArmy) {
        const marker = document.createElement("span");
        marker.className = `army ${army.owner} ${army.type}`;
        if (readyArmyIds.has(army.id)) {
          marker.classList.add("ready-army");
          cell.classList.add("ready-cell");
        }
        if (army.id === selectedArmy?.id) {
          marker.classList.add("active-army");
          cell.classList.add("active-cell");
        }
        if (army.acted) marker.classList.add("acted-army");
        const cargoCount = army.type === "transport" ? army.cargo?.length || 0 : 0;
        const fuelText = Number.isFinite(army.fuel) ? army.fuel : null;
        marker.innerHTML = `<span class="army-symbol" aria-hidden="true"></span><span class="army-hp">${army.hp}</span>${
          cargoCount ? `<span class="army-cargo">${cargoCount}</span>` : ""
        }${fuelText !== null ? `<span class="army-fuel">${fuelText}</span>` : ""}`;
        cell.append(marker);
        const armyTitle = armyTitleText(army);
        cell.title = city ? `${cityProductionText(city)}\n${armyTitle}` : armyTitle;
        cell.ariaLabel = `${cell.ariaLabel}, ${armyTitle}`;
      }

      if (selectedArmy?.x === x && selectedArmy?.y === y) cell.classList.add("selected");
      if (moveKeys.has(key(x, y))) {
        cell.classList.add(armyAt(x, y)?.owner && armyAt(x, y)?.owner !== selectedArmy?.owner ? "attack-target" : "move-target");
      }

      cell.addEventListener("click", () => handleCellClick(x, y));
      boardEl.append(cell);
    }
  }
}

function showRules() {
  rulesModal.classList.add("show");
  rulesModal.setAttribute("aria-hidden", "false");
  rulesCloseBtn.focus();
}

function hideRules() {
  rulesModal.classList.remove("show");
  rulesModal.setAttribute("aria-hidden", "true");
  rulesBtn.focus();
}

boardEl.addEventListener("pointerdown", () => {
  unlockAudio();
});
endTurnBtn.addEventListener("click", () => {
  unlockAudio();
  skipTurn();
});
livePauseBtn.addEventListener("click", toggleLivePlay);
document.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && productionModal.classList.contains("show")) {
    hideProductionModal({ continueTurn: true });
    return;
  }
  if (event.code === "Escape" && rulesModal.classList.contains("show")) {
    hideRules();
    return;
  }
  if (event.code !== "Space") return;
  const activeTag = document.activeElement?.tagName;
  if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
  event.preventDefault();
  unlockAudio();
  skipActiveUnit();
});
trainBtn.addEventListener("click", () => {
  if (demoRunning || trainingRunning) return;
  trainGames(trainingGameCount());
});
humanVsHumanBtn.addEventListener("click", () => {
  if (demoRunning || trainingRunning) return;
  startHumanVsHumanGame();
});
resetBrainBtn.addEventListener("click", () => {
  if (demoRunning || trainingRunning) return;
  unlockAudio();
  resetPersistentBrain();
  state.log = "AI learning reset and permanent storage cleared.";
  render();
});
rulesBtn.addEventListener("click", showRules);
rulesCloseBtn.addEventListener("click", hideRules);
rulesModal.addEventListener("click", (event) => {
  if (event.target === rulesModal) hideRules();
});
productionCloseBtn.addEventListener("click", () => hideProductionModal({ continueTurn: true }));
productionModal.addEventListener("click", (event) => {
  if (event.target === productionModal) hideProductionModal({ continueTurn: true });
});
demoAiBtn.addEventListener("click", runDemoAiGame);

loadUnitTypes().finally(() => {
  newGame();
});
