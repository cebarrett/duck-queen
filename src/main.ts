import './style.css'
import { Game } from './game/Game'

// Entry point. We keep this tiny on purpose: create the Game and start it.
// Everything interesting lives in the modules under src/game/.
const game = new Game()
game.start()
