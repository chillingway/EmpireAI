(function () {
  function hasNearbyLand(terrain, cell, radius, inBounds) {
    for (let y = cell.y - radius; y <= cell.y + radius; y += 1) {
      for (let x = cell.x - radius; x <= cell.x + radius; x += 1) {
        if (!inBounds(x, y)) continue;
        if (terrain[y][x] === "land") return true;
      }
    }
    return false;
  }

  function carveIsland(terrain, seeds, targetSize, helpers) {
    const { directions, inBounds, key, rand, shuffle, size } = helpers;
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
        .filter((cell) => inBounds(cell.x, cell.y) && cell.x > 0 && cell.y > 0 && cell.x < size - 1 && cell.y < size - 1);

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

  function makeMap(options) {
    const { directions, inBounds, key, rand, shuffle, size } = options;
    const halfWidth = Math.floor(size / 2);
    const leftInBounds = (x, y) => inBounds(x, y) && x < halfWidth;
    const helpers = { directions, inBounds: leftInBounds, key, rand, shuffle, size };
    const terrain = Array.from({ length: size }, () => Array.from({ length: size }, () => "water"));

    carveIsland(
      terrain,
      [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ],
      34,
      helpers,
    );

    const islandCount = 5 + rand(3);
    for (let i = 0; i < islandCount; i += 1) {
      let center = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const candidate = { x: 2 + rand(Math.max(1, halfWidth - 4)), y: 3 + rand(size - 6) };
        if (!hasNearbyLand(terrain, candidate, 3, leftInBounds)) {
          center = candidate;
          break;
        }
      }
      if (!center) continue;
      carveIsland(terrain, [center], 16 + rand(13), helpers);
    }

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < halfWidth; x += 1) {
        terrain[y][size - 1 - x] = terrain[y][x];
      }
    }

    return terrain;
  }

  function landCells(terrain) {
    const cells = [];
    for (let y = 0; y < terrain.length; y += 1) {
      for (let x = 0; x < terrain[y].length; x += 1) {
        if (terrain[y][x] === "land") cells.push({ x, y });
      }
    }
    return cells;
  }

  function placeCities(options) {
    const { cityCount, distance, farEnough, makeCity, minimumCityDistance, shuffle, size, terrain } = options;
    const mirrorX = (x) => size - 1 - x;
    const halfWidth = Math.floor(size / 2);
    const humanStart = { x: 1, y: 1 };
    const aiStart = { x: mirrorX(humanStart.x), y: humanStart.y };
    const cities = [makeCity("c-human", humanStart.x, humanStart.y, "human"), makeCity("c-ai", aiStart.x, aiStart.y, "ai")];

    const leftCandidates = shuffle(landCells(terrain)).filter(
      (cell) =>
        cell.x < halfWidth &&
        distance(cell, cities[0]) > 2 &&
        distance({ x: mirrorX(cell.x), y: cell.y }, cities[1]) > 2,
    );

    for (const cell of leftCandidates) {
      if (cities.length + 1 >= cityCount) break;
      const mirroredCell = { x: mirrorX(cell.x), y: cell.y };
      if (farEnough(cell, cities, minimumCityDistance) && farEnough(mirroredCell, [...cities, cell], minimumCityDistance)) {
        cities.push(makeCity(`c-${cities.length}`, cell.x, cell.y, "neutral"));
        cities.push(makeCity(`c-${cities.length}`, mirroredCell.x, mirroredCell.y, "neutral"));
      }
    }

    for (const cell of leftCandidates) {
      if (cities.length + 1 >= cityCount) break;
      const mirroredCell = { x: mirrorX(cell.x), y: cell.y };
      const pairOccupied = cities.some(
        (city) => (city.x === cell.x && city.y === cell.y) || (city.x === mirroredCell.x && city.y === mirroredCell.y),
      );
      if (!pairOccupied) {
        cities.push(makeCity(`c-${cities.length}`, cell.x, cell.y, "neutral"));
        cities.push(makeCity(`c-${cities.length}`, mirroredCell.x, mirroredCell.y, "neutral"));
      }
    }

    return cities;
  }

  window.EmpireMap = {
    landCells,
    makeMap,
    placeCities,
  };
})();
