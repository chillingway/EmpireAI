const SIZE = 20;
const CITY_COUNT = 10;
const START_ARMIES = 3;
const START_TANKS = 1;
const TRANSPORT_CAPACITY = 6;
const FIGHTER_FUEL = 15;
const STORAGE_KEY = "empireAI.childBrain.v1";
const SCOREBOARD_VERSION = 4;

const DEFAULT_UNIT_TYPES = {
  infantry: {
    label: "army",
    hitpoints: 5,
    speed: 1,
    productionTurns: 3,
    hitPower: 1,
    terrain: "land",
    produceWeight: 55,
  },
  tank: {
    label: "armored tank",
    hitpoints: 10,
    speed: 2,
    productionTurns: 6,
    hitPower: 2,
    terrain: "land",
    produceWeight: 22,
  },
  transport: {
    label: "transporter ship",
    hitpoints: 3,
    speed: 2,
    productionTurns: 5,
    hitPower: 1,
    terrain: "water",
    produceWeight: 13,
  },
  fighter: {
    label: "fighter plane",
    hitpoints: 1,
    speed: 6,
    productionTurns: 6,
    hitPower: 3,
    terrain: "air",
    fuel: FIGHTER_FUEL,
    produceWeight: 10,
  },
};

let UNIT_TYPES = normalizeUnitTypes(DEFAULT_UNIT_TYPES);
let PRODUCTION_POOL = buildProductionPool(UNIT_TYPES);

const directions = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];

function normalizeUnitTypes(source) {
  const normalized = {};

  for (const [type, config] of Object.entries(source)) {
    normalized[type] = {
      ...config,
      hp: config.hitpoints ?? config.hp ?? DEFAULT_UNIT_TYPES[type]?.hitpoints ?? DEFAULT_UNIT_TYPES.infantry.hitpoints,
      move: config.speed ?? config.move ?? DEFAULT_UNIT_TYPES[type]?.speed ?? DEFAULT_UNIT_TYPES.infantry.speed,
      strike: config.hitPower ?? config.strike ?? DEFAULT_UNIT_TYPES[type]?.hitPower ?? DEFAULT_UNIT_TYPES.infantry.hitPower,
      productionTurns:
        config.productionTurns ?? DEFAULT_UNIT_TYPES[type]?.productionTurns ?? DEFAULT_UNIT_TYPES.infantry.productionTurns,
      terrain: config.terrain ?? DEFAULT_UNIT_TYPES[type]?.terrain ?? DEFAULT_UNIT_TYPES.infantry.terrain,
      produceWeight: config.produceWeight ?? DEFAULT_UNIT_TYPES[type]?.produceWeight ?? 1,
    };
  }

  return normalized;
}

function buildProductionPool(unitTypes) {
  return Object.entries(unitTypes).flatMap(([type, config]) => Array.from({ length: config.produceWeight }, () => type));
}

async function loadUnitTypes() {
  try {
    const response = await fetch("./units.json?v=v2-unit-json-1", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unit data request failed: ${response.status}`);
    const json = await response.json();
    const source = { ...DEFAULT_UNIT_TYPES, ...json };
    if (source.army) {
      if (!json.infantry) source.infantry = source.army;
      delete source.army;
    }
    UNIT_TYPES = normalizeUnitTypes(source);
    PRODUCTION_POOL = buildProductionPool(UNIT_TYPES);
  } catch (error) {
    console.warn("Using fallback unit data.", error);
    UNIT_TYPES = normalizeUnitTypes(DEFAULT_UNIT_TYPES);
    PRODUCTION_POOL = buildProductionPool(UNIT_TYPES);
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
let productionCityId = null;

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
      boardTransport: 1.8,
      boardForNeutralExpansion: 4.4,
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

function key(x, y) {
  return `${x},${y}`;
}

function rand(max) {
  return Math.floor(Math.random() * max);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}

function hasNearbyLand(terrain, cell, radius = 2) {
  for (let y = cell.y - radius; y <= cell.y + radius; y += 1) {
    for (let x = cell.x - radius; x <= cell.x + radius; x += 1) {
      if (!inBounds(x, y)) continue;
      if (terrain[y][x] === "land") return true;
    }
  }
  return false;
}

function carveIsland(terrain, seeds, targetSize) {
  const island = [];
  const seen = new Set();
  const frontier = [];

  for (const seed of seeds) {
    if (!inBounds(seed.x, seed.y)) continue;
    const seedKey = key(seed.x, seed.y);
    if (seen.has(seedKey)) continue;
    seen.add(seedKey);
    terrain[seed.y][seed.x] = "land";
    island.push(seed);
    frontier.push(seed);
  }

  while (frontier.length && island.length < targetSize) {
    const origin = frontier[rand(frontier.length)];
    const candidates = shuffle(directions)
      .map((dir) => ({ x: origin.x + dir.dx, y: origin.y + dir.dy }))
      .filter((cell) => inBounds(cell.x, cell.y) && cell.x > 0 && cell.y > 0 && cell.x < SIZE - 1 && cell.y < SIZE - 1);

    for (const cell of candidates) {
      if (island.length >= targetSize) break;
      const cellKey = key(cell.x, cell.y);
      if (seen.has(cellKey)) continue;
      seen.add(cellKey);
      terrain[cell.y][cell.x] = "land";
      island.push(cell);
      frontier.push(cell);
    }
  }

  return island;
}

function makeMap() {
  const terrain = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => "water"));
  carveIsland(
    terrain,
    [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    34,
  );
  carveIsland(
    terrain,
    [
      { x: SIZE - 2, y: SIZE - 2 },
      { x: SIZE - 3, y: SIZE - 2 },
      { x: SIZE - 2, y: SIZE - 3 },
      { x: SIZE - 3, y: SIZE - 3 },
    ],
    34,
  );

  const islandCount = 5 + rand(3);
  for (let i = 0; i < islandCount; i += 1) {
    let center = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = { x: 3 + rand(SIZE - 6), y: 3 + rand(SIZE - 6) };
      if (!hasNearbyLand(terrain, candidate, 3)) {
        center = candidate;
        break;
      }
    }
    if (!center) continue;
    carveIsland(terrain, [center], 16 + rand(13));
  }

  return terrain;
}

function landCells(terrain) {
  const cells = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (terrain[y][x] === "land") cells.push({ x, y });
    }
  }
  return cells;
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function farEnough(cell, existing, minDistance) {
  return existing.every((other) => distance(cell, other) >= minDistance);
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
  };
}

function placeCities(terrain) {
  const cities = [
    makeCity("c-human", 1, 1, "human"),
    makeCity("c-ai", SIZE - 2, SIZE - 2, "ai"),
  ];
  const minimumCityDistance = SIZE <= 15 ? 2 : 3;

  const candidates = shuffle(landCells(terrain)).filter(
    (cell) => distance(cell, cities[0]) > 2 && distance(cell, cities[1]) > 2,
  );

  for (const cell of candidates) {
    if (cities.length >= CITY_COUNT) break;
    if (farEnough(cell, cities, minimumCityDistance)) {
      cities.push(makeCity(`c-${cities.length}`, cell.x, cell.y, "neutral"));
    }
  }

  for (const cell of candidates) {
    if (cities.length >= CITY_COUNT) break;
    if (!cities.some((city) => city.x === cell.x && city.y === cell.y)) {
      cities.push(makeCity(`c-${cities.length}`, cell.x, cell.y, "neutral"));
    }
  }

  return cities;
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
  const turns = city.produce;
  return `${city.owner} city, producing ${unitLabel({ type })}, ${turns} game turn${turns === 1 ? "" : "s"} left`;
}

function isFighter(unit) {
  return unit.type === "fighter";
}

function cargoSize(unit) {
  if (unit.type === "tank") return 2;
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
    (unit.type === "infantry" || unit.type === "tank") &&
    transportCargoUsed(transport) + cargoSize(unit) <= TRANSPORT_CAPACITY
  );
}

function canMoveOntoTransport(unit, transport) {
  if (!canBoardTransport(unit, transport)) return false;
  return distance(unit, transport) <= unitMoveRange(unit);
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
  return terrain === movement;
}

function producedUnitType() {
  return PRODUCTION_POOL[rand(PRODUCTION_POOL.length)] || "infantry";
}

function chooseAiProductionType(owner = "ai") {
  const ownerUnits = armiesFor(owner);
  const ownerCities = citiesFor(owner).length;
  const transports = ownerUnits.filter((unit) => unit.type === "transport").length;
  const fighters = ownerUnits.filter((unit) => unit.type === "fighter").length;
  const tanks = ownerUnits.filter((unit) => unit.type === "tank").length;

  if (transports < Math.max(1, Math.floor(ownerCities / 3))) return "transport";
  if (fighters < Math.max(1, Math.floor(ownerCities / 2))) return "fighter";
  if (tanks < Math.max(1, Math.floor(ownerCities / 2))) return "tank";
  return producedUnitType();
}

function chooseProductionType(owner) {
  return !humanVsHuman ? chooseAiProductionType(owner) : "infantry";
}

function makeUnit(owner, x, y, type = "infantry") {
  return {
    id: `${owner}-${crypto.randomUUID()}`,
    owner,
    type,
    x,
    y,
    hp: UNIT_TYPES[type]?.hp || UNIT_TYPES.infantry.hp,
    fuel: type === "fighter" ? FIGHTER_FUEL : undefined,
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
  document.querySelectorAll(".army-flyer, .crash-explosion").forEach((effect) => effect.remove());
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
  if (!state.humanVsHuman && !options.demo) beginHumanAiTurn();
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

function activePlayerOwner() {
  return state.phase === "ai" ? "ai" : "human";
}

function sideName(owner) {
  return owner === "human" ? "Blue" : "Red";
}

function opponentOwner(owner) {
  return owner === "human" ? "ai" : "human";
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
      if (isFighter(army) && distance(army, move) > (army.fuel ?? FIGHTER_FUEL)) continue;
      const occupant = currentState.armies.find((unit) => unit.x === move.x && unit.y === move.y);
      if (occupant?.owner === army.owner) {
        if (canMoveOntoTransport(army, occupant)) addMove(move);
        continue;
      }
      if (canUnloadTransport(army, move, currentState)) {
        addMove(move);
        continue;
      }
      if (!canEnterTerrain(army, currentState.terrain[move.y][move.x])) continue;
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
  while (attacker.hp > 0 && defender.hp > 0) {
    if (Math.random() < 0.5) defender.hp -= unitStrikePower(attacker);
    else attacker.hp -= unitStrikePower(defender);
  }

  const loser = attacker.hp <= 0 ? attacker : defender;
  const winner = loser === attacker ? defender : attacker;
  state.armies = state.armies.filter((army) => army.id !== loser.id);
  winner.hp = Math.max(1, winner.hp);
  return { winner, loser, attackerType, defenderType };
}

function captureCity(army) {
  if (isFighter(army)) return false;
  const city = cityAt(army.x, army.y);
  if (city && city.owner !== army.owner) {
    city.owner = army.owner;
    city.nextUnitType = chooseProductionType(army.owner);
    city.produce = unitProductionTurns(city.nextUnitType);
    return true;
  }
  return false;
}

function serviceFighter(unit, fuelCost) {
  if (!isFighter(unit)) return { crashed: false, refueled: false };
  const city = cityAt(unit.x, unit.y);
  if (city?.owner === unit.owner) {
    unit.fuel = FIGHTER_FUEL;
    return { crashed: false, refueled: true };
  }
  unit.fuel -= fuelCost;
  if (unit.fuel <= 0) {
    const crash = { x: unit.x, y: unit.y };
    state.armies = state.armies.filter((army) => army.id !== unit.id);
    return { crashed: true, refueled: false, crash };
  }
  return { crashed: false, refueled: false };
}

function moveArmy(army, target) {
  const fuelCost = distance(army, target);
  const defender = armyAt(target.x, target.y);
  if (canMoveOntoTransport(army, defender)) {
    defender.cargo = [...(defender.cargo || []), { ...army, x: null, y: null, acted: true, insideTransport: true }];
    state.armies = state.armies.filter((unit) => unit.id !== army.id);
    return { moved: false, captured: false, boarded: true, transport: defender };
  }

  if (canUnloadTransport(army, target)) {
    const { insideTransport, ...cargoUnit } = army.cargo.shift();
    state.armies.push({ ...cargoUnit, x: target.x, y: target.y, acted: true });
    army.acted = true;
    return { moved: false, captured: false, unloaded: true, transport: army, unit: cargoUnit };
  }

  let battle = null;
  if (defender && defender.owner !== army.owner) {
    battle = resolveBattle(army, defender);
    if (!state.armies.includes(army)) return { moved: false, captured: false, battle };
  }

  army.x = target.x;
  army.y = target.y;
  army.acted = true;
  const captured = captureCity(army);
  const fuel = serviceFighter(army, fuelCost);
  return { moved: true, captured, battle, fuel };
}

function getCellElement(x, y) {
  return boardEl.querySelector(`[data-x="${x}"][data-y="${y}"]`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      ? "Blue has destroyed every red unit and city, and sunk or neutralized every red transporter."
      : "Red has destroyed every blue unit and city, and sunk or neutralized every blue transporter.";
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
  if (result.fuel?.crashed) {
    const crash = result.fuel.crash || target;
    showCrashExplosion(crash.x, crash.y);
    playCrashExplosionSound();
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
  aiTurnTimer = setTimeout(() => runAiTurn("ai", turnToken), 220);
}

function beginHumanAiTurn() {
  selectedArmyId = null;
  state.skippedArmyIds = [];
  state.phase = "human";
  state.log = "Blue AI turn. Blue is moving each unit once.";
  const turnToken = gameToken;
  render();
  aiTurnTimer = setTimeout(() => runAiTurn("human", turnToken), 220);
}

function skipActiveUnit() {
  if (trainingRunning || demoRunning || isAnimating || state.gameOver || !["human", "ai"].includes(state.phase)) return;
  if (!state.humanVsHuman) return;
  const owner = activePlayerOwner();
  const activeArmy = activateNextArmy();
  if (!activeArmy) return;

  const ready = readyActiveArmies();
  if (ready.length <= 1) {
    state.skippedArmyIds = [];
    state.log = `${sideName(owner)} has no other ready unit. This unit still has the turn.`;
    render();
    return;
  }

  state.skippedArmyIds = (state.skippedArmyIds || []).filter((id) => id !== activeArmy.id);
  state.skippedArmyIds.push(activeArmy.id);
  selectedArmyId = null;
  const nextArmy = activateNextArmy();
  state.log = `${sideName(owner)} skipped ${unitLabel(activeArmy)} for now. ${unitLabel(nextArmy)} is active.`;
  render();
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

function isLandCombatUnit(unit) {
  return unit.type === "infantry" || unit.type === "tank";
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

  const features = {
    captureCity: city && city.owner !== army.owner && !isFighter(army) ? 1 : 0,
    captureNeutralCity: city?.owner === "neutral" && !isFighter(army) ? 1 : 0,
    landCaptureNeutralCity: city?.owner === "neutral" && landUnit ? 1 : 0,
    attackEnemy: enemy ? 1 : 0,
    attackTransport: isFighter(army) && enemy?.type === "transport" ? 1 : 0,
    boardTransport: friendlyTransport ? 1 : 0,
    boardForNeutralExpansion: friendlyTransport && neutralCities.length ? 1 : 0,
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
  if (turnToken !== gameToken || state.gameOver) return;
  const aiUnits = [...armiesFor(owner)];
  const enemyOwner = opponentOwner(owner);
  const actorName = `${sideName(owner)} AI`;
  let captures = 0;
  let kills = 0;

  for (const army of aiUnits) {
    if (turnToken !== gameToken) return;
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
    await wait(110);
  }

  state.log = `${actorName} moved. It captured ${captures} cit${captures === 1 ? "y" : "ies"} and destroyed ${kills} unit${
    kills === 1 ? "" : "s"
  }.`;
  if (owner === "human") beginAiTurn();
  else finishRound();
}

function finishRound() {
  state.skippedArmyIds = [];
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
  if (!state.gameOver && !state.humanVsHuman) {
    beginHumanAiTurn();
    return;
  }
  if (!state.gameOver && allActiveArmiesActed()) {
    beginAiTurn();
    return;
  }
  activateNextArmy();
  render();
}

function produceArmies() {
  for (const city of state.cities) {
    if (city.owner === "neutral") continue;
    city.produce -= 1;
    if (city.produce > 0) continue;
    if (!armyAt(city.x, city.y)) {
      state.armies.push(makeUnit(city.owner, city.x, city.y, city.nextUnitType || "infantry"));
      city.nextUnitType = chooseProductionType(city.owner);
    }
    city.produce = unitProductionTurns(city.nextUnitType || "infantry");
  }
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

function checkVictory() {
  if (state.gameOver) return;
  const humanUnits = activeUnitsFor("human");
  const aiUnits = activeUnitsFor("ai");
  const humanWon = aiUnits.length === 0 && citiesFor("ai").length === 0;
  const aiWon = humanUnits.length === 0 && citiesFor("human").length === 0;

  if (humanWon) {
    state.gameOver = true;
    state.winner = "human";
    state.log = "You win. Red has no units, cities, or usable transporter ships left.";
    if (state.humanVsHuman) {
      state.log = "Blue wins. Red has no units, cities, or usable transporter ships left.";
    } else {
      learnFromGame(false, { recordResult: state.recordResults !== false });
    }
  } else if (aiWon) {
    state.gameOver = true;
    state.winner = "ai";
    state.log = `${state.humanVsHuman ? "Red wins" : "AI wins"}. Blue has no units, cities, or usable transporter ships left.`;
    if (state.humanVsHuman) {
      state.log = "Red wins. Blue has no units, cities, or usable transporter ships left.";
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
  const fuel = type === "fighter" ? `, fuel ${FIGHTER_FUEL}` : "";
  return `${unit.hp} HP, move ${unit.move}, strike ${unit.strike}${fuel}`;
}

function selectedProductionCity() {
  return state.cities.find((city) => city.id === productionCityId) || null;
}

function showProductionModal(city) {
  if (!city || city.owner !== activePlayerOwner()) return;
  productionCityId = city.id;
  productionTitle.textContent = "What unit city is going to produce?";
  productionCityText.textContent = `This ${sideName(city.owner).toLowerCase()} city will produce ${unitLabel({
    type: city.nextUnitType || "infantry",
  })} in ${city.produce} turn${city.produce === 1 ? "" : "s"}.`;
  productionOptions.innerHTML = Object.entries(UNIT_TYPES)
    .map(([type, unit]) => {
      const selected = type === (city.nextUnitType || "infantry") ? " selected" : "";
      return `<button class="production-option${selected}" type="button" data-unit-type="${type}"><strong>${unit.label}</strong><span>${productionStatsText(type)}</span></button>`;
    })
    .join("");
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

function chooseHumanProduction(type) {
  const city = selectedProductionCity();
  if (!city || !UNIT_TYPES[type]) {
    hideProductionModal({ continueTurn: true });
    return;
  }
  city.nextUnitType = type;
  city.produce = unitProductionTurns(type);
  state.log = `City will produce ${unitLabel({ type })}.`;
  hideProductionModal({ continueTurn: true });
}

async function handleCellClick(x, y) {
  if (
    trainingRunning ||
    demoRunning ||
    isAnimating ||
    state.gameOver ||
    !["human", "ai"].includes(state.phase) ||
    !state.humanVsHuman ||
    productionModal.classList.contains("show")
  ) {
    return;
  }
  unlockAudio();
  const currentOwner = activePlayerOwner();
  const clickedArmy = armyAt(x, y);
  const clickedCity = cityAt(x, y);
  const activeArmy = activateNextArmy();
  const activeCanMoveToClicked =
    activeArmy &&
    (activeArmy.x !== x || activeArmy.y !== y) &&
    legalMoves(activeArmy).some((move) => move.x === x && move.y === y);

  if (clickedCity?.owner === currentOwner) {
    if (!activeCanMoveToClicked) {
      showProductionModal(clickedCity);
      return;
    }
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
  const capturedCity = result.captured ? cityAt(army.x, army.y) : null;
  if (result.fuel?.crashed) state.log = "Fighter ran out of fuel and crashed.";
  else if (result.battle?.loser.owner === opponentOwner(currentOwner)) state.log = `${sideName(currentOwner)} unit won the battle.`;
  else if (result.battle?.loser.owner === currentOwner) state.log = `${sideName(currentOwner)} unit was destroyed in battle.`;
  else if (result.captured) state.log = `${sideName(currentOwner)} captured a city. Choose what it will produce.`;
  else if (result.boarded) state.log = `Unit boarded a transporter. Cargo ${transportCargoUsed(result.transport)} / ${TRANSPORT_CAPACITY}.`;
  else if (result.unloaded) state.log = `Transporter unloaded ${unitLabel(result.unit)}.`;
  else if (result.fuel?.refueled && army.type === "fighter") state.log = "Fighter returned to a friendly city and refueled.";
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
  roundCount.textContent = state.round;
  humanCities.textContent = citiesFor("human").length;
  aiCities.textContent = citiesFor("ai").length;
  aiLessons.textContent = brain.lessons;
  const readyCount = readyActiveArmies().length;
  const humanPrompt = state.log.includes("flashing unit") ? state.log : `${state.log} Move the flashing unit.`;
  statusText.textContent =
    demoRunning
      ? state.log
      : state.log.startsWith("Training complete")
      ? state.log
      : !state.humanVsHuman
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
      if (city) {
        cell.classList.add("city");
        if (city.owner === "human") cell.classList.add("human-city");
        if (city.owner === "ai") cell.classList.add("ai-city");
        cell.title = cityProductionText(city);
        cell.ariaLabel = `${cell.ariaLabel}, ${cityProductionText(city)}`;
      }

      const army = armyAt(x, y);
      if (army) {
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
        const fuelText = army.type === "fighter" ? army.fuel ?? FIGHTER_FUEL : null;
        marker.innerHTML = `<span class="army-symbol" aria-hidden="true"></span><span class="army-hp">${army.hp}</span>${
          cargoCount ? `<span class="army-cargo">${cargoCount}</span>` : ""
        }${fuelText !== null ? `<span class="army-fuel">${fuelText}</span>` : ""}`;
        cell.append(marker);
        const armyTitle =
          army.type === "transport"
            ? `${army.owner} ${unitLabel(army)}, ${army.hp} HP, cargo ${transportCargoUsed(army)} / ${TRANSPORT_CAPACITY}`
            : army.type === "fighter"
            ? `${army.owner} ${unitLabel(army)}, ${army.hp} HP, fuel ${army.fuel ?? FIGHTER_FUEL} / ${FIGHTER_FUEL}`
            : `${army.owner} ${unitLabel(army)}, ${army.hp} HP`;
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
  await wait(delayMs);

  for (const army of [...armiesFor(owner)]) {
    if (!demoRunning || demoToken !== gameToken || state.gameOver) return false;
    if (!state.armies.includes(army) || army.acted) continue;
    const choice = chooseAiMove(army, state, brain);
    if (!choice) {
      army.acted = true;
      continue;
    }

    selectedArmyId = army.id;
    state.log = `${sideName} moves ${unitLabelWithArticle(army)}.`;
    render();
    await wait(delayMs);

    const beforeEnemyCount = armiesFor(owner === "human" ? "ai" : "human").length;
    const result = await performVisibleMove(army, choice.move, demoToken);
    if (result.cancelled) return false;
    rememberAiChoice(owner, choice.features);
    if (armiesFor(owner === "human" ? "ai" : "human").length < beforeEnemyCount) {
      state.log = `${sideName} destroyed an enemy unit.`;
    } else if (result.captured) {
      state.log = `${sideName} captured a city.`;
    } else {
      state.log = `${sideName} moved.`;
    }
    checkVictory();
    render();
    await wait(delayMs);
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
      await wait(delayMs);
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
  skipActiveUnit();
});
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
  brain = defaultBrain();
  saveBrain();
  state.log = "AI learning reset.";
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
productionOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-unit-type]");
  if (!button) return;
  chooseHumanProduction(button.dataset.unitType);
});
demoAiBtn.addEventListener("click", runDemoAiGame);

loadUnitTypes().finally(() => {
  newGame();
});
