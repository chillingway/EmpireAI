# EmpireAI

EmpireAI is a first playable turn-based strategy prototype built around a 20 x 20 island-and-sea map.

## Rules

- The world is a 20 x 20 board.
- Land is split into independent connected islands, and land units cannot enter water.
- There are 10 cities.
- Cities produce armies, tanks, amphibious compact vehicles, transporter ships, destroyers, and fighter planes for their current owner.
- A city is conquered when an army, tank, or amphibious compact vehicle enters it.
- Fighter planes cannot conquer cities, but returning to a friendly city reduces that city's production time by the fighter's hit power.
- Destroyer ships move on water, have 4 hitpoints, move 8 squares, strike for 3, and take 12 turns to produce.
- Amphibious compact vehicles move on land and water, have 4 hitpoints, move 2 squares, use cargo size 2, and have fuel 10.
- Units with fuel lose 1 fuel per square moved, refuel on the same square as their own city, and are destroyed when fuel reaches 0.
- Double-click a friendly city to change production. Single-clicking moves the active unit into the city when the move is legal.
- Transporter ships can carry armies, tanks, and amphibious compact vehicles. If a transporter is sunk, all cargo inside it is destroyed.
- Armies and tanks can attack transporter ships and destroyers from land without entering the water, dealing their hit power as damage.
- Enemy units on the same square fight randomly until one unit reaches 0 hitpoints and is destroyed.
- A player wins when the opponent has no owned cities and no armies, tanks, or amphibious compact vehicles that can conquer a city. Cargo inside transporters still counts.
- Press Space to skip only the active unit. Click **Skip Turn** to end the current side's turn and let the opponent start.

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
