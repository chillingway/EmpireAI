const SIZE = 15;
const CITY_COUNT = 10;
const START_ARMIES = 3;
const START_TANKS = 1;
const INFANTRY_HP = 5;
const TANK_HP = 10;
const PRODUCTION_ROUNDS = 5;
const STORAGE_KEY = "empireAI.childBrain.v1";

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

const boardEl = document.querySelector("#board");
const statusText = document.querySelector("#statusText");
const roundCount = document.querySelector("#roundCount");
const humanCities = document.querySelector("#humanCities");
const aiCities = document.querySelector("#aiCities");
const aiLessons = document.querySelector("#aiLessons");
const brainStats = document.querySelector("#brainStats");
const endTurnBtn = document.querySelector("#endTurnBtn");
const newGameBtn = document.querySelector("#newGameBtn");
const trainBtn = document.querySelector("#trainBtn");
const resetBrainBtn = document.querySelector("#resetBrainBtn");
const demoAiBtn = document.querySelector("#demoAiBtn");
const demoTempoInput = document.querySelector("#demoTempoInput");
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

function defaultBrain() {
  return {
    lessons: 0,
    wins: 0,
    losses: 0,
    weights: {
      captureCity: 4.5,
      attackEnemy: 2.6,
      moveToCity: 1.1,
      moveToEnemy: 0.65,
      protectCity: 0.35,
      stayAlive: 0.8,
    },
  };
}

function loadBrain() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultBrain();
  } catch {
    return defaultBrain();
  }
}

let brain = loadBrain();

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

function makeMap() {
  const terrain = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => "land"));
  const lakeSeeds = 5 + rand(3);

  for (let i = 0; i < lakeSeeds; i += 1) {
    let x = 2 + rand(SIZE - 4);
    let y = 2 + rand(SIZE - 4);
    const length = 4 + rand(7);

    for (let step = 0; step < length; step += 1) {
      if (inBounds(x, y)) terrain[y][x] = "water";
      const dir = directions[rand(directions.length)];
      x = Math.min(SIZE - 3, Math.max(2, x + dir.dx));
      y = Math.min(SIZE - 3, Math.max(2, y + dir.dy));
    }
  }

  terrain[1][1] = "land";
  terrain[SIZE - 2][SIZE - 2] = "land";
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

function placeCities(terrain) {
  const cities = [
    { id: "c-human", x: 1, y: 1, owner: "human", produce: PRODUCTION_ROUNDS },
    { id: "c-ai", x: SIZE - 2, y: SIZE - 2, owner: "ai", produce: PRODUCTION_ROUNDS },
  ];
  const minimumCityDistance = SIZE <= 15 ? 2 : 3;

  const candidates = shuffle(landCells(terrain)).filter(
    (cell) => distance(cell, cities[0]) > 2 && distance(cell, cities[1]) > 2,
  );

  for (const cell of candidates) {
    if (cities.length >= CITY_COUNT) break;
    if (farEnough(cell, cities, minimumCityDistance)) {
      cities.push({ id: `c-${cities.length}`, x: cell.x, y: cell.y, owner: "neutral", produce: PRODUCTION_ROUNDS });
    }
  }

  for (const cell of candidates) {
    if (cities.length >= CITY_COUNT) break;
    if (!cities.some((city) => city.x === cell.x && city.y === cell.y)) {
      cities.push({ id: `c-${cities.length}`, x: cell.x, y: cell.y, owner: "neutral", produce: PRODUCTION_ROUNDS });
    }
  }

  return cities;
}

function unitMaxHp(unit) {
  return unit.type === "tank" ? TANK_HP : INFANTRY_HP;
}

function unitMoveRange(unit) {
  return unit.type === "tank" ? 2 : 1;
}

function unitLabel(unit) {
  return unit.type === "tank" ? "tank" : "army";
}

function makeUnit(owner, x, y, type = "infantry") {
  return {
    id: `${owner}-${crypto.randomUUID()}`,
    owner,
    type,
    x,
    y,
    hp: type === "tank" ? TANK_HP : INFANTRY_HP,
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
    setDemoControlsEnabled(true);
  }
  if (aiTurnTimer) {
    clearTimeout(aiTurnTimer);
    aiTurnTimer = null;
  }
  isAnimating = false;
  document.querySelectorAll(".army-flyer").forEach((flyer) => flyer.remove());
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
    aiMemory: [],
    log: options.demo ? "Demo AI vs AI training starts." : "Move the flashing unit.",
  };
  selectedArmyId = null;
  hideVictoryMessage();
  render();
}

function startNewGame() {
  unlockAudio();
  newGame();
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

function legalMoves(army, currentState = state) {
  const moves = [];
  const range = unitMoveRange(army);

  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > range) continue;
      const move = { x: army.x + dx, y: army.y + dy };
      if (!inBounds(move.x, move.y)) continue;
      if (currentState.terrain[move.y][move.x] === "water") continue;
      const occupant = currentState.armies.find((unit) => unit.x === move.x && unit.y === move.y);
      if (occupant?.owner === army.owner) continue;
      moves.push(move);
    }
  }

  return moves;
}

function resolveBattle(attacker, defender) {
  const attackerType = attacker.type;
  const defenderType = defender.type;
  while (attacker.hp > 0 && defender.hp > 0) {
    if (Math.random() < 0.5) defender.hp -= 1;
    else attacker.hp -= 1;
  }

  const loser = attacker.hp <= 0 ? attacker : defender;
  const winner = loser === attacker ? defender : attacker;
  state.armies = state.armies.filter((army) => army.id !== loser.id);
  winner.hp = Math.max(1, winner.hp);
  return { winner, loser, attackerType, defenderType };
}

function captureCity(army) {
  const city = cityAt(army.x, army.y);
  if (city && city.owner !== army.owner) {
    city.owner = army.owner;
    city.produce = PRODUCTION_ROUNDS;
    return true;
  }
  return false;
}

function moveArmy(army, target) {
  const defender = armyAt(target.x, target.y);
  let battle = null;
  if (defender && defender.owner !== army.owner) {
    battle = resolveBattle(army, defender);
    if (!state.armies.includes(army)) return { moved: false, captured: false, battle };
  }

  army.x = target.x;
  army.y = target.y;
  army.acted = true;
  const captured = captureCity(army);
  return { moved: true, captured, battle };
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
    playDrumHit(ctx, now, 88, 0.32, 0.5);
    playMetalClash(ctx, now + 0.035, 0.18, 0.24);
    playDrumHit(ctx, now + 0.12, 64, 0.26, 0.32);
    playMetalClash(ctx, now + 0.17, 0.16, 0.16);
    return;
  }

  playMetalClash(ctx, now, 0.12, 0.22);
  playSnareHit(ctx, now + 0.05, 0.09, 0.16);
  playMetalClash(ctx, now + 0.12, 0.1, 0.16);
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

function hideVictoryMessage() {
  victoryOverlay.classList.remove("show");
  victoryOverlay.setAttribute("aria-hidden", "true");
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
  victoryKicker.textContent = winner === "human" ? "Empire secured" : "Empire lost";
  victoryTitle.textContent = winner === "human" ? "Victory" : "Defeat";
  victoryDetail.textContent =
    winner === "human"
      ? "Your armies conquered every city."
      : "The AI conquered every city.";
  victoryOverlay.classList.add("show");
  victoryOverlay.setAttribute("aria-hidden", "false");
  launchVictoryStars();
  playVictoryFanfare();
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
  if (result.captured) playCaptureFanfare();
  isAnimating = false;
  return result;
}

function allHumanArmiesActed() {
  return armiesFor("human").every((army) => army.acted || legalMoves(army).length === 0);
}

function readyHumanArmies() {
  if (state.phase !== "human" || state.gameOver) return [];
  return armiesFor("human").filter((army) => !army.acted && legalMoves(army).length > 0);
}

function activateNextHumanArmy() {
  if (state.phase !== "human" || state.gameOver) {
    selectedArmyId = null;
    return null;
  }

  const selectedArmy = state.armies.find((army) => army.id === selectedArmyId);
  if (selectedArmy?.owner === "human" && !selectedArmy.acted && legalMoves(selectedArmy).length > 0) {
    return selectedArmy;
  }

  const nextArmy = readyHumanArmies()[0] || null;
  selectedArmyId = nextArmy?.id || null;
  return nextArmy;
}

function beginAiTurn() {
  selectedArmyId = null;
  state.phase = "ai";
  state.log = "AI turn. The opponent is moving each unit once.";
  const turnToken = gameToken;
  render();
  aiTurnTimer = setTimeout(() => runAiTurn(turnToken), 220);
}

function endHumanTurn() {
  if (demoRunning || isAnimating || state.gameOver || state.phase !== "human") return;
  armiesFor("human").forEach((army) => {
    army.acted = true;
  });
  state.log = "You skipped the rest of your army moves.";
  beginAiTurn();
}

function scoreMove(army, move, currentState, learningBrain) {
  const city = currentState.cities.find((item) => item.x === move.x && item.y === move.y);
  const enemy = currentState.armies.find((unit) => unit.x === move.x && unit.y === move.y && unit.owner !== army.owner);
  const enemyCities = currentState.cities.filter((item) => item.owner !== army.owner);
  const enemyArmies = currentState.armies.filter((unit) => unit.owner !== army.owner);
  const ownCities = currentState.cities.filter((item) => item.owner === army.owner);
  const nearestCity = Math.min(...enemyCities.map((item) => distance(move, item)), 12);
  const nearestEnemy = Math.min(...enemyArmies.map((unit) => distance(move, unit)), 12);
  const nearestOwnCity = ownCities.length ? Math.min(...ownCities.map((item) => distance(move, item)), 12) : 12;

  const features = {
    captureCity: city && city.owner !== army.owner ? 1 : 0,
    attackEnemy: enemy ? 1 : 0,
    moveToCity: (12 - nearestCity) / 12,
    moveToEnemy: (12 - nearestEnemy) / 12,
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

async function runAiTurn(turnToken = gameToken) {
  aiTurnTimer = null;
  if (turnToken !== gameToken || state.gameOver) return;
  const aiUnits = [...armiesFor("ai")];
  let captures = 0;
  let kills = 0;

  for (const army of aiUnits) {
    if (turnToken !== gameToken) return;
    if (!state.armies.includes(army)) continue;
    const choice = chooseAiMove(army);
    if (!choice) continue;
    const beforeEnemyCount = armiesFor("human").length;
    const result = await performVisibleMove(army, choice.move, turnToken);
    if (result.cancelled) return;
    if (result.captured) captures += 1;
    if (armiesFor("human").length < beforeEnemyCount) kills += 1;
    state.aiMemory.push(choice.features);
    render();
    await wait(110);
  }

  state.log = `AI moved. It captured ${captures} cit${captures === 1 ? "y" : "ies"} and destroyed ${kills} unit${kills === 1 ? "" : "s"}.`;
  finishRound();
}

function finishRound() {
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
  if (!state.gameOver && allHumanArmiesActed()) {
    beginAiTurn();
    return;
  }
  activateNextHumanArmy();
  render();
}

function produceArmies() {
  for (const city of state.cities) {
    if (city.owner === "neutral") continue;
    city.produce -= 1;
    if (city.produce > 0) continue;
    city.produce = PRODUCTION_ROUNDS;
    if (!armyAt(city.x, city.y)) {
      state.armies.push(makeUnit(city.owner, city.x, city.y));
    }
  }
}

function learnFromGame(aiWon) {
  const reward = aiWon ? 1 : -1;
  const rate = 0.08;
  const memories = state.aiMemory.length ? state.aiMemory : [{ stayAlive: 1 }];
  for (const features of memories) {
    for (const [name, value] of Object.entries(features)) {
      brain.weights[name] = Math.max(-2, Math.min(8, brain.weights[name] + reward * rate * value));
    }
  }
  brain.lessons += 1;
  if (aiWon) brain.wins += 1;
  else brain.losses += 1;
  saveBrain();
}

function checkVictory() {
  if (state.gameOver) return;
  const humanWon = citiesFor("human").length === CITY_COUNT;
  const aiWon = citiesFor("ai").length === CITY_COUNT;

  if (humanWon) {
    state.gameOver = true;
    state.winner = "human";
    state.log = "You win. You conquered every city.";
    learnFromGame(false);
  } else if (aiWon) {
    state.gameOver = true;
    state.winner = "ai";
    state.log = "AI wins. It conquered every city and learned from this empire.";
    learnFromGame(true);
  }

  if (state.gameOver && !state.victoryAnnounced && !state.silent) {
    state.victoryAnnounced = true;
    showVictoryMessage(state.winner);
  }
}

async function handleCellClick(x, y) {
  if (demoRunning || isAnimating || state.gameOver || state.phase !== "human") return;
  unlockAudio();
  const clickedArmy = armyAt(x, y);

  if (clickedArmy?.owner === "human" && !clickedArmy.acted) {
    selectedArmyId = clickedArmy.id;
    state.log = "Move the flashing unit to a highlighted square, city, or enemy.";
    render();
    return;
  }

  const army = activateNextHumanArmy();
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
  if (result.battle?.loser.owner === "ai") state.log = "Your unit won the battle.";
  else if (result.battle?.loser.owner === "human") state.log = "Your unit was destroyed in battle.";
  else if (result.captured) state.log = "You captured a city.";
  else state.log = "Unit moved.";

  checkVictory();
  if (!state.gameOver && allHumanArmiesActed()) {
    beginAiTurn();
  } else {
    activateNextHumanArmy();
    render();
  }
}

function render() {
  const activeArmy = demoRunning ? state.armies.find((army) => army.id === selectedArmyId) : activateNextHumanArmy();
  roundCount.textContent = state.round;
  humanCities.textContent = citiesFor("human").length;
  aiCities.textContent = citiesFor("ai").length;
  aiLessons.textContent = brain.lessons;
  const readyCount = readyHumanArmies().length;
  const humanPrompt = state.log.includes("flashing unit") ? state.log : `${state.log} Move the flashing unit.`;
  statusText.textContent =
    demoRunning
      ? state.log
      : state.phase === "human" && !state.gameOver && readyCount > 0
      ? `${humanPrompt} ${readyCount} unit${readyCount === 1 ? " is" : "s are"} ready.`
      : state.log;
  renderBrain();

  const selectedArmy = activeArmy;
  const readyArmyIds = new Set(readyHumanArmies().map((army) => army.id));
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
        cell.title = `${city.owner} city, produces in ${city.produce}`;
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
        marker.innerHTML = `<span class="army-symbol" aria-hidden="true"></span><span class="army-hp">${army.hp}</span>`;
        cell.append(marker);
        cell.title = `${army.owner} ${unitLabel(army)}, ${army.hp} HP`;
      }

      if (selectedArmy?.x === x && selectedArmy?.y === y) cell.classList.add("selected");
      if (moveKeys.has(key(x, y))) {
        cell.classList.add(armyAt(x, y)?.owner === "ai" ? "attack-target" : "move-target");
      }

      cell.addEventListener("click", () => handleCellClick(x, y));
      boardEl.append(cell);
    }
  }
}

function renderBrain() {
  const rows = [
    ["Wins", brain.wins],
    ["Losses", brain.losses],
    ["Capture", brain.weights.captureCity.toFixed(2)],
    ["Attack", brain.weights.attackEnemy.toFixed(2)],
    ["Cities", brain.weights.moveToCity.toFixed(2)],
    ["Enemies", brain.weights.moveToEnemy.toFixed(2)],
  ];
  brainStats.innerHTML = rows.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join("");
}

function cloneForSim(baseState) {
  return {
    terrain: baseState.terrain.map((row) => [...row]),
    cities: baseState.cities.map((city) => ({ ...city })),
    armies: baseState.armies.map((army) => ({ ...army })),
    round: baseState.round,
    phase: baseState.phase,
    gameOver: false,
    winner: null,
    victoryAnnounced: false,
    silent: true,
    aiMemory: [],
    log: "",
  };
}

function trainGames(count) {
  const visibleState = state;
  for (let i = 0; i < count; i += 1) {
    newGame();
    const sim = cloneForSim(state);
    state = sim;
    while (!state.gameOver && state.round < 120) {
      for (const owner of ["human", "ai"]) {
        for (const army of [...armiesFor(owner)]) {
          if (!state.armies.includes(army)) continue;
          const choice =
            owner === "ai"
              ? chooseAiMove(army, state, brain)
              : { move: shuffle(legalMoves(army))[0], features: {} };
          if (choice?.move) {
            const result = moveArmy(army, choice.move);
            if (owner === "ai") state.aiMemory.push(choice.features);
            if (result.captured && owner === "human") state.aiMemory.push({ captureCity: 0.25 });
          }
        }
      }
      produceArmies();
      state.round += 1;
      checkVictory();
    }
    if (!state.gameOver) learnFromGame(citiesFor("ai").length + armiesFor("ai").length > citiesFor("human").length + armiesFor("human").length);
  }
  state = visibleState;
  state.log = `The AI child practiced ${count} simulated games.`;
  render();
}

function demoTempoMs() {
  const seconds = Number.parseFloat(demoTempoInput.value);
  const safeSeconds = Number.isFinite(seconds) ? Math.min(3, Math.max(0.1, seconds)) : 0.5;
  demoTempoInput.value = safeSeconds.toFixed(1);
  return safeSeconds * 1000;
}

function setDemoControlsEnabled(enabled) {
  endTurnBtn.disabled = !enabled;
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
    state.log = `${sideName} moves a ${unitLabel(army)}.`;
    render();
    await wait(delayMs);

    const beforeEnemyCount = armiesFor(owner === "human" ? "ai" : "human").length;
    const result = await performVisibleMove(army, choice.move, demoToken);
    if (result.cancelled) return false;
    if (owner === "ai") state.aiMemory.push(choice.features);
    if (result.captured && owner === "human") state.aiMemory.push({ captureCity: 0.25 });
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

boardEl.addEventListener("pointerdown", () => {
  unlockAudio();
});
endTurnBtn.addEventListener("click", () => {
  unlockAudio();
  endHumanTurn();
});
document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  const activeTag = document.activeElement?.tagName;
  if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
  event.preventDefault();
  unlockAudio();
  endHumanTurn();
});
trainBtn.addEventListener("click", () => {
  if (demoRunning) return;
  unlockAudio();
  trainGames(50);
});
resetBrainBtn.addEventListener("click", () => {
  if (demoRunning) return;
  unlockAudio();
  brain = defaultBrain();
  saveBrain();
  state.log = "AI learning reset.";
  render();
});
demoAiBtn.addEventListener("click", runDemoAiGame);

newGame();
