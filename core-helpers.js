(function () {
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

  function inBounds(x, y, size) {
    return x >= 0 && y >= 0 && x < size && y < size;
  }

  function distance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  function farEnough(cell, existing, minDistance) {
    return existing.every((other) => distance(cell, other) >= minDistance);
  }

  window.EmpireCore = {
    directions,
    distance,
    farEnough,
    inBounds,
    key,
    rand,
    shuffle,
  };
})();
