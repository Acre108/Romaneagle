# Project maps

Maps saved from the in-game editor are written here by the local Vite development server.

Each `.json` file uses the validated battlefield map schema. Start the game with `PLAY_GAME.cmd`
or `npm run dev` to save and load maps through the campaign-select screen.

Saving over the map you opened happens straight away. Saving under a name that belongs to another
map asks first. Files are named from the map name, so "River Ford!" and "river ford" are the same map.

A `.json` file here that cannot be used stays in place, and the saved maps screen names it and says why.
