# EmpireAI

EmpireAI is a first playable turn-based strategy prototype built around a 15 x 15 land-and-lake map.

## Rules

- The world is a 15 x 15 board.
- Land is always connected, while water behaves like lakes that armies cannot enter.
- There are 10 cities.
- Cities produce one new army every 5 game turns for their current owner.
- A city is conquered when an army moves onto it.
- Fighter planes cannot conquer cities, but returning to a friendly city reduces that city's production time by the fighter's hit power.
- Human and AI armies can move one square north, north-east, east, south-east, south, south-west, west, or north-west.
- Armies have 5 hitpoints.
- If an army moves onto an enemy army, they fight. Random hits continue until one army reaches 0 hitpoints and is destroyed.
- A player wins by conquering all cities.
- Press Space, or click **Space: Skip Rest**, to skip the rest of your army movements for the current round.

## AI Learning

The AI child learns from complete games, but it also records which kinds of moves it tried during play. Wins strengthen the move patterns it used, while losses weaken them.

It currently learns from:

- Wins and losses.
- Capturing cities.
- Attacking enemy armies.
- Moving toward enemy or neutral cities.
- Moving toward enemy armies.
- Staying close enough to protect owned cities.
- Keeping damaged armies alive.

Use **Train 50** to let the AI practice simulated games in the background. Its learning data is saved in the browser with `localStorage`.

## Run

Open `index.html` in a browser.
