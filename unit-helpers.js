(function () {
  function createDefaultUnitTypes(fighterFuel) {
    return {
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
        fuel: fighterFuel,
        produceWeight: 10,
      },
      destroyer: {
        label: "Destroyer",
        hitpoints: 4,
        speed: 8,
        productionTurns: 12,
        hitPower: 3,
        terrain: "sea",
        fuel: 150,
        produceWeight: 10,
      },
    };
  }

  function normalizeTerrain(terrain) {
    return terrain === "sea" ? "water" : terrain;
  }

  function normalizeUnitTypes(source, defaults) {
    const normalized = {};

    for (const [type, config] of Object.entries(source)) {
      normalized[type] = {
        ...config,
        hp: config.hitpoints ?? config.hp ?? defaults[type]?.hitpoints ?? defaults.infantry.hitpoints,
        move: config.speed ?? config.move ?? defaults[type]?.speed ?? defaults.infantry.speed,
        strike: config.hitPower ?? config.strike ?? defaults[type]?.hitPower ?? defaults.infantry.hitPower,
        productionTurns: config.productionTurns ?? defaults[type]?.productionTurns ?? defaults.infantry.productionTurns,
        terrain: normalizeTerrain(config.terrain ?? defaults[type]?.terrain ?? defaults.infantry.terrain),
        produceWeight: config.produceWeight ?? defaults[type]?.produceWeight ?? 1,
      };
    }

    return normalized;
  }

  function buildProductionPool(unitTypes) {
    return Object.entries(unitTypes).flatMap(([type, config]) => Array.from({ length: config.produceWeight }, () => type));
  }

  function mergeUnitTypeConfig(defaults, json) {
    const source = { ...defaults, ...json };
    if (source.army) {
      if (!json.infantry) source.infantry = source.army;
      delete source.army;
    }
    if (source.Destroyer) {
      if (!json.destroyer) source.destroyer = source.Destroyer;
      delete source.Destroyer;
    }
    return source;
  }

  window.EmpireUnits = {
    buildProductionPool,
    createDefaultUnitTypes,
    mergeUnitTypeConfig,
    normalizeTerrain,
    normalizeUnitTypes,
  };
})();
