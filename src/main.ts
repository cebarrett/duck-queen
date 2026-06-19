import './style.css'
import { Game } from './game/Game'
import { SaveManager } from './game/persistence/SaveManager'
import { LocalStorageBackend } from './game/persistence/LocalStorageBackend'

// Entry point. We keep this tiny on purpose: read any saved game, then create the
// Game and start it. Everything interesting lives in the modules under src/game/.
//
// Swapping persistence to a cloud store later is a one-line change here — pass a
// different StorageBackend to SaveManager; nothing else in the game changes.
async function boot(): Promise<void> {
  const saves = new SaveManager(new LocalStorageBackend())
  const loaded = await saves.load() // null = fresh game
  const game = new Game(saves, loaded)
  game.start()
}

void boot()
