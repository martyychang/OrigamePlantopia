# BGA Studio Development Guide — Origami Plantopia

> **Purpose:** This file is automatically read by Gemini CLI on every session.
> It contains internalized knowledge from the
> [BGA Studio Complete Walkthrough](https://en.doc.boardgamearena.com/Create_a_game_in_BGA_Studio:_Complete_Walkthrough)
> and project-specific conventions for **Origami Plantopia**.

---

## Project Layout

The BGA game lives inside `origameplantopia/` and is synced to BGA Studio via
SFTP. All game code changes go in that folder.

```
origameplantopia/
├── modules/
│   ├── php/
│   │   ├── Game.php              # Main server-side game class
│   │   └── States/               # One PHP class per game state
│   │       ├── PlayerTurn.php    # Active-player state (id: 10)
│   │       ├── NextPlayer.php    # Game-logic state (id: 90)
│   │       └── EndScore.php      # Pre-end-game state (id: 98)
│   ├── js/
│   │   └── Game.js               # Client-side game logic (bundled output)
│   └── css/                      # (empty — CSS compiled from SCSS or written directly)
├── src-disabled/                 # TypeScript + SCSS source (disabled for now)
│   ├── ts/
│   └── scss/
├── img/                          # Game images & sprites
├── misc/                         # Miscellaneous data files (≤1 MB, checked in)
├── gameinfos.jsonc                # Game metadata (name, players, duration, etc.)
├── gameoptions.jsonc              # Game options (variants, draft, etc.)
├── gamepreferences.jsonc          # User preferences (colorblind, etc.)
├── stats.jsonc                    # Statistics definitions (table + player)
├── dbmodel.sql                    # Database schema
├── origameplantopia.css           # Compiled CSS stylesheet
├── package.json                   # npm scripts: build:ts, build:scss, watch
├── rollup.config.mjs             # Rollup bundler config for TypeScript
├── tsconfig.json                  # TypeScript compiler config
├── bga-framework.d.ts            # TypeScript type definitions for BGA framework
├── _ide_helper.php               # PHP IDE helper for BGA framework
└── LICENCE_BGA                   # BGA framework license
```

---

## Framework Version: Modern (2024+)

This project uses the **modern BGA framework**. Key differences from older
patterns:

| Aspect | Modern (this project) | Legacy (avoid) |
|---|---|---|
| State machine | PHP classes in `modules/php/States/` extending `GameState` | `states.inc.php` array |
| Actions | `#[PossibleAction]` attribute on state class methods | Separate action PHP file + `possibleactions` array |
| Material data | PHP class (e.g. `Material.php`) or inline in `Game.php` | `material.inc.php` |
| Game options | `gameoptions.jsonc` | `gameoptions.inc.php` |
| Statistics | `stats.jsonc` | `stats.inc.php` |
| Game info | `gameinfos.jsonc` | `gameinfos.inc.php` |
| Client HTML | Generated entirely by JS/TS in `setup()` | `.tpl` template + `.view.php` |
| Client actions | `bga.actions.performAction()` (promise-based) | `this.ajaxcall()` |
| Notifications | `bga.notifications.setupPromiseNotifications()` | `dojo.subscribe('notif_xxx', ...)` |
| Status bar | `bga.statusBar.addActionButton()` | `this.addActionButton()` |
| State handlers | `bga.states.register('StateName', handler)` | `onUpdateActionButtons` switch |
| Player panels | `bga.playerPanels.getElement(playerId)` | `$('player_board_' + playerId)` |
| Game area | `bga.gameArea.getElement()` | Direct DOM by ID |
| Counters | `PlayerCounter` component | `this.addToStockWithId()` |
| Parameters | `#[JsonParam]` attribute for typed JSON params | Manual `$_GET` / `$_POST` parsing |

> **IMPORTANT:** Do NOT use Dojo, `.tpl` files, `states.inc.php`,
> `material.inc.php`, or `this.ajaxcall()`. Always use the modern patterns.

---

## Core Architecture

### Server Side (PHP)

#### Game.php — `Bga\Games\OrigamePlantopia\Game`
- Extends `\Bga\GameFramework\Table`
- Namespace: `Bga\Games\OrigamePlantopia`
- Responsibilities:
  - `__construct()`: Initialize counters, material data (`$CARD_TYPES`), notification decorators
  - `setupNewGame($players, $options)`: Create player records, init stats, init game tables, activate first player, return initial state class
  - `getAllDatas(int $currentPlayerId)`: Return all visible game state to the client (player info, board state, material data, counters)
  - `getGameProgression()`: Return 0–100 integer for progress bar
  - `upgradeTableDb($from_version)`: Database migration

#### State Classes — `modules/php/States/`
Each state is a PHP class extending `Bga\GameFramework\States\GameState`:

```php
<?php
declare(strict_types=1);
namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\Games\OrigamePlantopia\Game;

class MyState extends GameState {
    function __construct(protected Game $game) {
        parent::__construct($game,
            id: 10,                              // Unique state ID (1–98)
            type: StateType::ACTIVE_PLAYER,      // or GAME, MULTIPLE_ACTIVE_PLAYER
            // Optional:
            // updateGameProgression: true,
        );
    }

    // Return data visible to the active player
    public function getArgs(): array { return []; }

    // Called when state becomes active
    public function onEnteringState(int $activePlayerId) {}

    // Player actions — declared with attribute
    #[PossibleAction]
    public function actDoSomething(int $activePlayerId, array $args) {
        // Validate, update DB, notify, return next state class
        return NextState::class;
    }

    // Handle zombie (disconnected) player
    function zombie(int $playerId) {
        return NextPlayer::class;
    }
}
```

**State types:**
- `StateType::ACTIVE_PLAYER` — Waits for one player's action
- `StateType::GAME` — Server-side logic, no player input (auto-transitions)
- `StateType::MULTIPLE_ACTIVE_PLAYER` — Multiple players act simultaneously

**Reserved state IDs:** `1` (gameSetup), `99` (gameEnd) — never use these.

**State transitions:** Return the next state's class name (e.g., `return NextPlayer::class;`) or a reserved state ID constant for gameEnd (`return 99;`).

### Client Side (JavaScript/TypeScript)

#### Game.js — `modules/js/Game.js`
- `export class Game` — main game class
- Constructor receives `bga` object with framework utilities
- Key methods:
  - `setup(gamedatas)`: Build UI from server data, set up notifications
  - `setupNotifications()`: Register notification handlers

#### State Handlers
Each state gets a JS class registered with the framework:

```javascript
class MyStateHandler {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        if (!isCurrentPlayerActive) return;

        // Add action buttons to status bar
        this.bga.statusBar.addActionButton(
            _('Do Something'),
            () => this.bga.actions.performAction("actDoSomething", { param: value })
        );

        // Highlight clickable elements
        document.querySelectorAll('.clickable').forEach(el => {
            el.classList.add('active_slot');
            el.addEventListener('click', this.onClick);
        });
    }

    onLeavingState(args, isCurrentPlayerActive) {
        // Clean up click handlers and visual cues
        document.querySelectorAll('.active_slot').forEach(el => {
            el.classList.remove('active_slot');
            el.removeEventListener('click', this.onClick);
        });
    }

    onClick = (event) => {
        const id = event.currentTarget.id;
        this.bga.actions.performAction("actDoSomething", { id });
    };
}

// Register in Game constructor:
this.bga.states.register('MyState', new MyStateHandler(this, bga));
```

### Notifications

**Server side** (PHP):
```php
$this->bga->notify->all("notifName", clienttranslate('${player_name} does something'), [
    "player_id" => $playerId,
    "player_name" => $this->game->getPlayerNameById($playerId),
    // ... other args
]);
```

**Client side** (JS):
```javascript
setupNotifications() {
    this.bga.notifications.setupPromiseNotifications({
        // logger: console.log   // Uncomment for debugging
    });
}

// Notification handler method:
async notif_notifName(args) {
    // Animate or update UI
}
```

---

## Database Design

### Schema (`dbmodel.sql`)
- Currently uses the default template (no custom tables yet)
- Standard tables provided by framework: `global`, `stats`, `gamelog`, `player`
- Common patterns:
  - **Card table** (for Deck component): `card_id`, `card_type`, `card_type_arg`, `card_location`, `card_location_arg`
  - **Token table** (general purpose): `token_key` (VARCHAR PK), `token_location` (VARCHAR), `token_state` (INT)
- Keep it simple — usually 1–2 tables with ≤5 columns

### Material Data
Static, non-changing game info (names, tooltips, rules text, strengths, etc.)
goes in a Material class or directly in `Game::$CARD_TYPES`. **Not** in the
database.

---

## Development Workflow

### Build Pipeline
```bash
# TypeScript → JS (via Rollup)
npm run build:ts

# SCSS → CSS (via Sass)
npm run build:scss

# Watch both
npm run watch
```

### Iteration Cycle
1. Edit source files locally
2. SFTP auto-sync uploads to BGA Studio server
3. In browser: **Express Start** a test game
4. Use red arrow button near player names to switch between test players (no
   login/logout needed)
5. Use browser dev tools to inspect elements and debug

### Recommended Development Order
1. **Game info** — Fill `gameinfos.jsonc` with real data
2. **Layout & Graphics** — Create HTML structure in `setup()`, CSS sprites, board layout
3. **Database Schema** — Design `dbmodel.sql`
4. **Game Setup** — Implement `setupNewGame()` in `Game.php`
5. **getAllDatas** — Return complete visible game state
6. **State Machine** — Create state classes in `modules/php/States/`
7. **Client State Handlers** — Build UI interactions per state
8. **User Input** — Hook click handlers, send actions via `bga.actions.performAction()`
9. **Notifications & Animation** — Handle server notifications, animate piece movement
10. **Wrap Up** — Game progression, zombie mode, statistics, tooltips, translations

### Key Principles
- **Reduce the rules first** — Start with basic/beginner rules, no expansions
- **Keep ≤20 states** — Use client-side sub-states for complex choices
- **Sprite images** — Combine pieces into sprite sheets, use `background-position`
- **Percentage positioning** — Easier to scale later
- **No sound effects** — Use only framework-provided sounds
- **Translation** — Mark all UI strings with `clienttranslate()` (PHP) or `_()` (JS)
- **Tooltips** — All image-based UI elements need tooltips
- **Visual cues** — Use `box-shadow` or `outline` (not `border`) for clickable highlights
- **Don't commit** publisher graphics files or SFTP passwords to GitHub

---

## Game Element Design Pattern

Every game piece (card, token, meeple) appears in **4 layers**:

1. **Database** — Instance record: `(key, location, state)`
2. **Material** — Type definition: `(name, tooltip, rules, properties)`
3. **CSS** — Visual: sprite image + `background-position`
4. **Client JS** — DOM element: `<div id="piece_color_N" class="piece piece_color">`

Use reverse-DNS-style naming: `meeple_ff0000_7`, `card_yellow_magic_2`

---

## Configuration Files

### `gameinfos.jsonc`
- Game name, publisher, BGG ID, player counts, duration
- Player colors array, favorite colors support
- Interface width constraints
- Tiebreaker description

### `gameoptions.jsonc`
- Option IDs: 100–199
- Game variants (e.g., draft, solo, advanced rules)

### `gamepreferences.jsonc`
- Preference IDs: 100–199
- User customizations (e.g., colorblind support)
- Uses `cssPref` for automatic CSS class application

### `stats.jsonc`
- Table-level and player-level statistics
- Each stat has: `id`, `name`, `type` ("int" or "float")

---

## Pre-Release Checklist Summary
- [ ] Game progression returns accurate 0–100 value
- [ ] Zombie mode works for all states
- [ ] Meaningful statistics defined and tracked
- [ ] Game logs explain all actions
- [ ] Tiebreaker implemented (aux score)
- [ ] All UI strings marked for translation
- [ ] All image elements have tooltips
- [ ] Copyright headers updated
- [ ] Build produces clean output (no console errors)
- [ ] Works with all supported player counts

---

## Useful BGA Resources
- [BGA Studio Overview](https://en.doc.boardgamearena.com/Studio)
- [First Steps](https://en.doc.boardgamearena.com/First_steps_with_BGA_Studio)
- [Game Art: img Directory](https://en.doc.boardgamearena.com/Game_art:_img_directory)
- [Deck Component](https://en.doc.boardgamearena.com/Deck)
- [BGA Studio Cookbook](https://en.doc.boardgamearena.com/BGA_Studio_Cookbook)
- [Debugging Guide](https://en.doc.boardgamearena.com/Practical_debugging)
- [Pre-release Checklist](https://en.doc.boardgamearena.com/Pre-release_checklist)
- [BGA Studio Guidelines](https://en.doc.boardgamearena.com/BGA_Studio_Guidelines)
- [BGA Developers Forum](https://forum.boardgamearena.com/viewforum.php?f=12)
- [BGA Dev Discord](https://discord.gg/YxEUacY)
- [PHP IDE Helper](https://en.doc.boardgamearena.com/Tools_and_tips_of_BGA_Studio)
- [TypeScript Definitions](https://en.doc.boardgamearena.com/Game_interface_logic:_yourgamename.js)
