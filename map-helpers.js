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
    const helpers = { directions, inBounds, key, rand, shuffle, size };
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
    carveIsland(
      terrain,
      [
        { x: size - 2, y: size - 2 },
        { x: size - 3, y: size - 2 },
        { x: size - 2, y: size - 3 },
        { x: size - 3, y: size - 3 },
      ],
      34,
      helpers,
    );

    const islandCount = 5 + rand(3);
    for (let i = 0; i < islandCount; i += 1) {
      let center = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const candidate = { x: 3 + rand(size - 6), y: 3 + rand(size - 6) };
        if (!hasNearbyLand(terrain, candidate, 3, inBounds)) {
          center = candidate;
          break;
        }
      }
      if (!center) continue;
      carveIsland(terrain, [center], 16 + rand(13), helpers);
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
    const cities = [makeCity("c-human", 1, 1, "human"), makeCity("c-ai", size - 2, size - 2, "ai")];

    const candidates = shuffle(landCells(terrain)).filter(
      (cell) => distance(cell, cities[0]) > 2 && distance(cell, cities[1]) > 2,
    );

    for (const cell of candidates) {
      if (cities.length >= cityCount) break;
      if (farEnough(cell, cities, minimumCityDistance)) {
        cities.push(makeCity(`c-${cities.length}`, cell.x, cell.y, "neutral"));
      }
    }

    for (const cell of candidates) {
      if (cities.length >= cityCount) break;
      if (!cities.some((city) => city.x === cell.x && city.y === cell.y)) {
        cities.push(makeCity(`c-${cities.length}`, cell.x, cell.y, "neutral"));
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
