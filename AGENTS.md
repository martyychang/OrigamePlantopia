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

---

## Deck Component Best Practices

The BGA `Deck` component has strict method signatures. Using the wrong number of arguments will result in an `ArgumentCountError`.

- **`pickCards(int $nbr, string $location, int $player_id)`**
  Draws `$nbr` cards from `$location` and automatically moves them to the `hand` location of `$player_id`. Note that the third argument is an **integer** (the player ID), not a string location name.

- **`pickCardsForLocation(int $nbr, string $from_location, string $to_location, int $location_arg = 0)`**
  Draws `$nbr` cards from `$from_location` and moves them to any custom `$to_location` (e.g., `'draft'`). It sets the `location_arg` to `$location_arg`. This is the correct method to use when drawing cards to a temporary or specialized zone instead of the player's hand.

Both methods return an array of the picked cards, which is safe to check with `count()` or merge. If you need to manually handle deck reshuffling, verify the count of drawn cards against the requested amount before attempting to draw the remainder.

### Deck Construction and Locations

When constructing decks during `setupNewGame`, do not place sub-types of cards (like "bonus" cards or tokens) into the standard `'deck'` location if they should not be randomly drawn with the rest of the deck. Standard deck operations (like `shuffle('deck')` or `pickCardsForLocation(..., 'deck', ...)`) operate blindly on all cards in that location, which can inadvertently draw unwanted sub-types.

**Best Practice:**
- **Separate Methods:** Create separate initialization methods for different card groups (e.g., `getDeckCards()` vs `getBonusCards()`).
- **Separate Locations:** Instantiate the secondary cards directly into a custom location (e.g., `$this->myCards->createCards(MyCards::getBonusCards(), 'bonus_deck');`) to keep the main deck pure.
- **Cleanup:** Ensure that any phase cleanup logic returns these secondary cards back to their custom location (e.g., `'bonus_deck'`), not the main `'deck'`.

---

## Initial Setup & Mulligan Pattern

**Backend (`setupNewGame`)**:
- Initialize and populate decks (e.g. `$this->plantCards->createCards()`)
- Shuffle the deck (`$this->plantCards->shuffle('deck')`)
- Deal starting hands (`$this->plantCards->pickCards(6, 'deck', $playerId)`)
- Initial state should be a `MULTIPLE_ACTIVE_PLAYER` state for simultaneous decisions (e.g., Keep or Redraw).

**Frontend (`Game.js`)**:
- Receive the hand from `getAllDatas()` via `setup(gamedatas)`.
- Use a stock component (like `bga-cards` or `ebg.stock`) to render the hand.
- In the `onEnteringState` for the setup decision state:
  - Provide buttons in the status bar (e.g., Keep, Redraw) for the active player.
  - Trigger backend actions when buttons are clicked.

**State Machine**:
- Use `#[PossibleAction]` in the state class to handle choices.
- In a `MULTIPLE_ACTIVE_PLAYER` state, call `$this->bga->gamestate->setPlayerNonMultiactive($activePlayerId, NextState::class)` when a player completes *all* their required choices for that state.
- **Multi-Step Decisions**: If players must perform multiple actions before they are completely done with the state (e.g., both keeping/redrawing their hand AND selecting a character), DO NOT call `setPlayerNonMultiactive` early. Let the player remain active until they have fulfilled all requirements, so they can undo or change their choices if the game rules allow it before advancing.
- **Recording Temporary State**: If you need to keep track of a player's choices during a `MULTIPLE_ACTIVE_PLAYER` phase (like recording whether they chose Keep or Redraw), use `ALTER TABLE player ADD ...` in `dbmodel.sql` to add custom columns. Do NOT repurpose standard BGA framework columns like `player_score_aux`, as these are required for end-game tiebreakers.
- **Exposing Temporary State**: Remember that custom columns in the `player` table are not automatically passed to the client. You must explicitly select them in the SQL query inside `Game.php`'s `getAllDatas()` method to make them accessible in `Game.js` via `gamedatas.players[playerId].your_custom_column`.
- **UI Gotcha (Duplicate Buttons)**: In `MULTIPLE_ACTIVE_PLAYER` states, when transitioning sequentially, `onEnteringState` fires while `isCurrentPlayerActive` is still `false`. BGA then fires a separate packet that triggers `onPlayerActivationChange(args, true)`. 
  - *Best Practice*: Call `this.onPlayerActivationChange(args, isCurrentPlayerActive)` from inside `onEnteringState` to handle both initial refresh states and live transitions.
  - *Critical*: Always start `onPlayerActivationChange` with `this.bga.statusBar.removeActionButtons();` before rendering buttons. Otherwise, BGA's dual-triggering (once from your manual call, and once from the framework's native call upon activation) will spawn duplicate action buttons in the status bar!

---

## Action Parameters & Autowiring Gotchas

The BGA Modern framework uses PHP Reflection to automatically map JSON keys from the frontend `bga.actions.performAction()` call to the PHP method parameters in the state class. 

- **Array Typing Issue**: You **cannot** use the `array` type hint directly for method parameters in a `#[PossibleAction]` (e.g., `public function actPlant(array $cardIds)`) without specific attributes like `#[JsonParam]` or `#[IntArrayParam]`. Doing so will throw a `BadMethodCallException: parameter type array is not supported by action autowiring function`.
- **Workaround Strategy**: The simplest and most robust way to send arrays (like a list of card IDs) from the frontend is to send a delimited string (e.g., `paymentCardIds.join(';')`) and type the PHP parameter as `string`. Inside the PHP method, you can decode it and safely re-assign it to the same variable to keep logic clean:
  ```php
  #[PossibleAction]
  public function actPlant(string $cardIds) {
      $cardIds = $cardIds === '' ? [] : array_map('intval', explode(';', $cardIds));
      // Now $cardIds is a typed integer array.
  }
  ```
- **Parameter Naming**: The keys in the JS payload must exactly match the PHP parameter names. If you rename a parameter in PHP to avoid conflicts, you must also update the JS key. Re-assigning to the argument variable internally in PHP avoids this coupling issue.

---

## State Transitions & Frontend Synchronization

When transitioning between states—especially into a `MULTIPLE_ACTIVE_PLAYER` state—the client UI (`Game.js`) might retain stale values in `gamedatas` from previous phases (like a `planting_status` left at `1` instead of `0`). This can cause the UI to improperly lock players into a "Waiting for other players..." state.

**Do NOT rely on hardcoded cache resets in the frontend:**
Attempting to forcefully reset local variables inside `onEnteringState` in `Game.js` (e.g., `p.planting_status = 0`) is fragile and breaks if a user reconnects (F5) mid-phase.

**Do NOT perform state-reset DB updates inside `onEnteringState` of a `MULTIPLE_ACTIVE_PLAYER` state:**
Because of how the BGA framework broadcasts `MULTIPLE_ACTIVE_PLAYER` transitions, `getArgs()` is evaluated *before or simultaneously* with the state's `onEnteringState()`. If you execute `UPDATE player SET planting_status = 0` inside `onEnteringState()`, `getArgs()` might read the *stale* value from the DB and transmit that stale value to all clients, permanently locking them.

**Best Practice for Syncing State Variables:**
1. **Reset in the Previous State:** Perform database updates that reset player statuses (e.g., `UPDATE player SET player_planting_status = 0`) in the *outgoing* transition of the previous state (e.g., in `WeatherPhaseReveal` before `return WeatherPhaseBonus::class;`), or in a dedicated intermediate `GAME` state.
2. **Transmit True State via `getArgs()`:** In the destination state, read the *live* database values in `getArgs()` and return them (e.g., `return ['planting_statuses' => $statuses];`).
3. **Sync in Frontend:** In the frontend's `onEnteringState`, use the provided `args` to strictly overwrite local cache before calling `onPlayerActivationChange`.
   * **Crucial JS Syntax:** The BGA framework unpacks the returned array keys directly into the `args` parameter. You must access them as `args.planting_statuses`, **NOT** `args.args.planting_statuses`.

```javascript
    onEnteringState(args, isCurrentPlayerActive) {
        if (args && args.planting_statuses) {
            Object.entries(args.planting_statuses).forEach(([pId, status]) => {
                if (this.game.gamedatas.players[pId]) {
                    this.game.gamedatas.players[pId].planting_status = status;
                }
            });
        }
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }
```

---

## MULTIPLE_ACTIVE_PLAYER Deactivation Gotchas

When a player finishes their action in a `MULTIPLE_ACTIVE_PLAYER` state, you must call `$this->game->gamestate->setPlayerNonMultiactive($playerId, NextState::class)`. The framework will locally deactivate the player and, if they are the **last** active player, synchronously transition the global game state to `NextState::class`.

**Do NOT loop over all players to deactivate them:**
```php
// ANTI-PATTERN - DO NOT DO THIS!
if ($allReady) {
    foreach ($players as $pId => $pInfo) {
        $this->game->gamestate->setPlayerNonMultiactive($pId, NextState::class);
    }
}
```
If you do this, the state transition will trigger synchronously during the loop the moment it hits the last active player. The new state's `onEnteringState` (which often reactivates players via `setAllPlayersMultiactive()`) will execute. Once execution returns to the loop, it will continue calling `setPlayerNonMultiactive` on the remaining players, thereby incorrectly deactivating them **in the new state**.

**Best Practice:**
Always call `setPlayerNonMultiactive` **only** on the `$playerId` who performed the action triggering the transition.
```php
// CORRECT PATTERN
$playerId = (int)$this->game->getCurrentPlayerId();
if ($allReady) {
    $this->game->gamestate->setPlayerNonMultiactive($playerId, NextState::class);
} else {
    // Note: For multi-step actions, check if the individual $playerId has completed ALL their steps before calling this.
    $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
}
```


---

## End-Game Triggering Pattern

When an end-game condition can be triggered mid-round (e.g., a player achieves a winning threshold during their turn), but the rules state the current round or phase must be completed before the game ends:

1. **Global State Flag**: Initialize a global state variable (e.g., `endgame_triggered = 0`) in `setupNewGame()`.
2. **Conditional Check**: At the natural conclusion of the required round/phase (e.g., in the `onEnteringState` of the final resolution step like `WeatherPhaseGrow`), check if the condition is met.
3. **Set Flag**: If the condition is met and the flag is `0`, set the flag to `1` using `$this->game->setGameStateValue()`. This guarantees the flag persists across page reloads.
4. **Transition**: After completing all logic for that final resolution state, check the flag. If it is `1`, return the final state class (`return EndScore::class;`). If `0`, return the normal next phase class.

---

## Shared Component Synchronization & UI State Persistence

When a backend state transition changes a global shared UI component (like removing cards from a public deck), you must explicitly transmit the updated state of that shared component to all clients via `notify->all`. BGA does not automatically sync physical deck locations dynamically if the frontend is unaware.
* **Notification Payloads:** You can include updated global data directly within a transition's or cleanup's notification payload (e.g., `$this->bga->notify->all('weatherCleared', '', ['bonusMarket' => $bonusMarket]);`). This allows the frontend's notification handler to seamlessly re-render shared market areas without requiring a full page refresh.

Additionally, when custom dynamic UI states depend on transient card locations (like a played "bonus weather" card moving into a custom `weather_public_bonus` location), you must:
1. Update the local `this.gamedatas` cache directly within the notification handler (e.g., `notif_playerPlayedBonus`) so the data persists locally during live play.
2. Ensure that the initial `setup(gamedatas)` correctly reads and renders that specific slice of `gamedatas`, merging it with other generic components if necessary. Failure to process this local cache in `setup` will result in visual elements vanishing if the user refreshes the page mid-round.

---

## UI Action State Resets

When building custom UI interactions where a player builds up a selection before submitting (like selecting multiple cards), you must explicitly reset your local state variables immediately upon submission or cancellation.

**Best Practice:**
Always clear temporary selection arrays and flags (e.g., `this.selectedCards = []; this.isSelecting = false;`) immediately after calling `this.bga.actions.performAction(...)`, and also when the user clicks a "Pass" or "Cancel" button. Failing to do so will cause the stale selection to persist and reappear the next time the interaction is triggered for that player.
