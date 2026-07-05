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

### Live Scoring & Phase Transitions
- For games requiring live intermediate scoring (e.g., recalculated at the end of each phase), a robust pattern is to define a dedicated `calculateAllScores()` method in `Game.php`. This method should compute scores, update `player_score` and `player_score_aux` in the DB, and fire an `updateScores` notification.
- **Timing**: Trigger this calculation inside the `onEnteringState()` of the *subsequent* phase's start state (e.g., `WeatherPhaseStart` or `PlantingPhaseStart`) and `EndScore`. This guarantees the score perfectly reflects the state at the exact boundary of the previous phase.

### Client Side (JavaScript/TypeScript)

#### Game.js — `modules/js/Game.js`
- `export class Game` — main game class
- Constructor receives `bga` object with framework utilities
- Key methods:
  - `setup(gamedatas)`: Build UI from server data, set up notifications
  - `setupNotifications()`: Register notification handlers

**Class scoping gotcha**: `Game.js` declares the outer `Game` class _and_ several inner state-handler classes (`SetupDecisions`, `PlantingPhase`, `WeatherPhaseChoose`, etc.) in the same file. They share lexical scope but **not `this`**:
- Inside `Game` methods (`setup`, `renderHand`, `renderPlantInPlanter`, `notif_*`), `this` is the Game instance — use `this.gamedatas`, `this.plantingPhase`, `this.bga`. There is no `this.game`.
- Inside an inner state class (`PlantingPhase.onEnteringState`, `updateStatusBar`, etc.), `this` is the state instance — use `this.game.gamedatas`, `this.game.helperFn`, `this.bga`.
- Helpers must live on the class whose methods call them. If `renderHand` (on Game) calls `this.plantCardBody(...)`, that helper must be defined on `Game`, not on `PlantingPhase`. Misplacing it surfaces as `"this.X is not a function"` at game load.
- Notification handlers (`notif_*`) all live on `Game`. To trigger a state re-render from one, delegate explicitly: `this.plantingPhase.onEnteringState(null, true)`.

#### Player Panels & Custom Counters
- Standard BGA framework updates player scores via `bga.playerPanels.getScoreCounter(playerId).toValue(newScore)`.
- To display custom counters (e.g., Energy or Hand count), inject HTML directly into `this.bga.playerPanels.getElement(playerId)` during `setup()`, and hook it up using the legacy `ebg.counter()` component.
- **Tip**: To cleanly initialize hand counters, use the `Deck` component's PHP method `$this->cards->countCardsByLocationArgs('hand')` to fetch all players' hand counts in one query, then pass it down in `getAllDatas()`.

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

**Notification name matching is exact.** `setupPromiseNotifications` auto-subscribes every `notif_X` method to the notification named exactly `X` — no fuzzy match, no plural/singular fallback. If the PHP sends `"keptCards"` and the JS handler is `notif_keptCard` (singular), the handler is silently never invoked and the client never re-renders. When renaming a notification on either side, **rename both**, and grep both files for the old name before committing.

**Payload shape changes need the same audit.** If the server payload changes (e.g., `{card: …}` → `{cards: […]}`), grep every `notif_*` handler that reads it. Mismatches produce `args.card.id` → `undefined.id` errors that may or may not be caught depending on whether the path is actually exercised.

---

## Database Design

### Schema (`dbmodel.sql`)
- Currently uses the default template (no custom tables yet)
- Standard tables provided by framework: `global`, `stats`, `gamelog`, `player`
- Common patterns:
  - **Card table** (for Deck component): `card_id`, `card_type`, `card_type_arg`, `card_location`, `card_location_arg`
  - **Token table** (general purpose): `token_key` (VARCHAR PK), `token_location` (VARCHAR), `token_state` (INT)
- Keep it simple — usually 1–2 tables with ≤5 columns
- **String Length Gotcha**: If your game features long names (e.g., card names exceeding 32 characters like "Abnormal Potted Planted Potted Plants"), be sure to increase the standard `VARCHAR(32)` limit to `VARCHAR(64)` or higher in `dbmodel.sql` for columns like `card_type`. Otherwise, BGA will throw a fatal "Data too long for column" error during game setup.

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

**`$card['type']` is the card_type column, NOT a plant_type constant.** BGA's Deck library returns the `card_type` column value (e.g. `'Cattus'`, `'Geometree'`) in the `type` field of every card array — that's the human-readable card NAME, not the typed family constant like `'baby_cactus'` or `'trv_tree'`. Any helper that compares against family constants (`PlantCards::isBaby`, `PlantCards::isTreevolved`, `getFamily`) must either be passed the `plant_type` field (looked up via `Game::$PLANT_CARD_TYPES[$card['type']]['plant_type']`) **or** be implemented to accept both forms. The "accepts both" pattern is preferred because it makes every existing call site (which passes `$card['type']` directly) silently correct:
```php
public static function resolvePlantType(string $input): ?string {
    if (in_array($input, self::ALL_TYPES, true)) return $input;
    return self::getTypes()[$input]['plant_type'] ?? null;
}
public static function isBaby(string $cardOrType): bool {
    $pt = self::resolvePlantType($cardOrType);
    return $pt !== null && in_array($pt, [self::BABY_CACTUS, ...], true);
}
```
Symptom of getting this wrong: cost-validation branches silently skipped, character abilities never firing, eligibility checks returning `false` despite valid game state — all because `in_array('Cattus', ['baby_cactus', ...])` is always `false`.

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

## Complex Multi-Step State Machines & Effect Queues

When a single action (like planting a card) triggers a chain of multiple effects (e.g., "draw cards, discard a card, then gain a weather card"), avoid creating distinct PHP GameState classes for every possible intermediate combination.

**Best Practice:**
1. **Database Queue:** Add a JSON column to the `player` table (e.g., `player_pending_effects`).
2. **Push Effects:** When the card is played, construct an array of effect objects and serialize it into this column.
3. **Process Loop:** Create a single method (e.g., `processPendingEffects()`) that loads the queue and processes non-interactive effects in a `while` loop. 
4. **Pause for Input:** When an interactive effect is reached (like `draft_cards` or `discard_cards`), `break` out of the loop, set the player's status (e.g., `player_planting_status = 3`), and fire a notification with the current queue to instruct the frontend to render the appropriate UI prompt.
5. **Resolve and Resume:** The frontend calls a corresponding `actResolve*` method (e.g., `actResolveDraft`) which handles the user's input, removes the effect from the front of the queue (`array_shift`), saves the queue, and immediately calls `processPendingEffects()` to resume the chain.
6. **Moot-effect short-circuit:** Before pausing for an interactive effect, check whether the current game state can actually satisfy it. Example: a `level_up` with target `LEVEL_UP_OTHER` is moot if the player has no other plants in their garden (Natural Flower planted as the first flower). Pop moot effects silently and `continue` the loop — never trap the player on an unfulfillable prompt. Centralize the checks in an `isInteractiveEffectMoot($playerId, $effect)` helper so each new effect type has one place to opt in.
7. **Skip button as fallback:** Surface a Skip action (a generic `actSkipPendingEffect` on the server, plus a button on every choice prompt) for *optional* effects (`level_up`, `level_up_family`, `gain_weather`). Gate it server-side with an `isEffectSkippable($effect)` whitelist so forced/penalty effects (e.g., `discard_cards`) and effects with their own bespoke flow (e.g., `banana_offer`'s built-in Skip) aren't accidentally bypassable.
8. **Re-rendering after a status-only change:** Server actions that reset `player_planting_status` and pop the queue (e.g., `actUseBananaAbility` after the player chose to use Banana) must emit a notification that updates the client's local `gamedatas.players[pId].planting_status` AND re-triggers `onEnteringState`. Without it, the client UI remains stuck on the prior prompt even though the server has moved on. The reusable shape is the existing `playerGainedAction` notification — emit it from any action that grants a fresh planting action, and the corresponding `notif_playerGainedAction` handler refreshes `gamedatas` + delegates to `this.plantingPhase.onEnteringState(null, true)`.

---

## PHP Division & Math Gotchas

When implementing game rules that require division (e.g., "Gain 1 point for every 2 cards in hand"), be careful with PHP's standard math functions.

- **`ceil($val / 2)`**: Rounds **up**. If a player has 1 card, `ceil(0.5)` equals 1, incorrectly awarding a point.
- **`floor($val / 2)`**: Rounds **down**. This is the correct way to award points for complete sets or pairs.

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

## Bonus Weather Card Locations

Bonus Weather cards have three legal locations and the lifecycle is strict
(see https://trello.com/c/B5g3UmED). Treat this as the canonical model:

| Location | Meaning | Visibility |
| --- | --- | --- |
| `bonus_deck` | Supply pool. Cards are dealt out from here. | Public (count + identity). |
| `weather_public_bonus` (`location_arg = player_id`) | **Held publicly by a player.** Persists across rounds until the player chooses to play it. | Public. Every player sees every other player's held bonus weather. |
| `weather_played_bonus` (`location_arg = player_id`) | Played by the player THIS round. Counted toward growth in `WeatherPhaseGrow`, then returned to `bonus_deck`. | Public for the duration of the round. |

Rules:

- **Never** put a Bonus Weather card into `hand`. Bonus weather is public — hand is private.
- All gain paths (Mushroom claim, plant `gain_weather` effects, `actResolveGainWeather`) target `weather_public_bonus`.
- `actPlayBonusWeather` validates the card is in `weather_public_bonus` for the calling player, then moves it to `weather_played_bonus`.
- `WeatherPhaseGrow` reads `weather_played_bonus` for the round's contribution and clears it back to `bonus_deck`. **It does NOT touch `weather_public_bonus`** — held cards persist.
- The end-of-phase `weatherCleared` notification carries the updated `weatherPublicBonus` snapshot so clients re-sync.
- Public gain notifications (`playerGainedWeather`, `playerReceivedWeather`) carry the gained card payload so every client can render the new tile, not just the recipient. Bonus weather card identity is not hidden information.
- The client's `computePlayerStats` counts `weather_public_bonus` only (the *held* count). Cards in `weather_played_bonus` are intentionally excluded because the displayed count should decrement when a card is played.

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

---

## CSS Sprites & Inline-Style Gotchas

BGA renders most card art via CSS sprites (one image, many cells addressed by `background-position`). Two recurring pitfalls:

**1. Never use the `background:` shorthand on a sprite-bearing element.** `background: #e8f8f5` is the shorthand form; it resets *every* `background-*` sub-property to its default — including `background-image`. Inline styles beat external CSS, so a sprite class like `.plantopia-adult-card { background-image: url('img/sprite.png'); }` will be silently clobbered and the cell will render as an empty colored frame. **Always use the individual sub-property** (`background-color: #e8f8f5`) on any element that participates in a sprite class. Sub-properties compose with the CSS-set `background-image` instead of resetting it.

**2. Container-relative sprite addressing.** For a sprite of `N` columns × `M` rows, set `background-size: (N*100)% (M*100)%` so one cell is exactly 100% × 100% of the container, then address cells with:
```
background-position: (col / (N - 1) * 100)%  (row / (M - 1) * 100)%
```
This formula is container-size-independent — the same CSS works for hand cards (120×180), planter slots (~140 wide), and the level-3 tilted view. Drive the per-card position with an attribute selector so the CSS file is one base class + N flat lines:
```css
.adult-card { background-image: url('img/plants_adult.png'); background-size: 700% 300%; background-repeat: no-repeat; }
.adult-card[data-card-type="Geometree"]   { background-position: 0%       0%; }
.adult-card[data-card-type="Symmetree"]   { background-position: 16.6667% 0%; }
/* ... */
```

**3. Key the sprite by canonical card identity, not the translated display name.** `card.type` from the server is the `card_type` column (untranslated, stable). `cardInfo.name` is the `clienttranslate()` output and will diverge under locale switches. Render `data-card-type="${card.type}"`, not `${cardInfo.name}`, so the attribute selector keeps matching in every locale.

---

## Testing State Classes Outside BGA Studio (PHP)

BGA Studio provides no local runtime — no DB, no CLI test harness. To verify server-side game logic without deploying and clicking through Studio, `require` the REAL, unmodified state-class file against a minimal stub of the BGA framework instead of writing a parallel re-implementation.

**Pattern** (see `tests/php/harness.php` + `tests/php/CattusDraftTest.php`):
- Define fake classes under the *exact* namespaces the state file imports (`Bga\GameFramework\*`, `Bga\Games\OrigamePlantopia\Game`) in a separate file, `require`d *before* the real state file. Because PHP class resolution here is just `require` order (no autoloader), whichever definition loads first under a given fully-qualified name wins — the harness's `FakeGame`/`FakeDeck` satisfy `use Bga\Games\OrigamePlantopia\Game;` without ever touching the real `Game.php` (which depends on the live BGA Table/DB machinery and can't run standalone).
- A file that declares multiple namespaces MUST use braced `namespace X { ... }` blocks for ALL of them, including top-level global code (e.g. a `clienttranslate()` stub) — PHP forbids mixing bracketed and unbracketed namespace declarations in one file.
- Model the DB with a plain in-memory array of rows (id/type/type_arg/location/location_arg) mirroring what BGA's Deck component returns — not with the real Deck class.
- **Fake `player_*` columns must use the REAL DB column names as array keys, not short/friendly aliases.** `DbQuery()`'s stub parses raw SQL text (`UPDATE player SET player_pending_effects = '...' WHERE player_id = 1`) and can only recover the column name that's *literally in the SQL string* — `player_pending_effects`, not `pending_effects`. If `getUniqueValueFromDb()`'s read-side stub uses a different key than the write-side parser produces, every write silently lands on a different array key than every read checks, and the state machine looks completely broken in the test even though the real code (and the real DB) would work fine. This exact mismatch cost real debugging time once — keep read/write key names in lockstep with the schema in `dbmodel.sql`.
- When parsing `UPDATE ... SET col1 = 'val,with,commas', col2 = 5` style SQL, never `explode(',', ...)` naively — a JSON-encoded column value (e.g. `player_pending_effects`) contains commas, and a naive split shreds it into garbage fragments. Track quote state character-by-character and only split on commas *outside* single-quoted string literals.
- Run with plain `php path/to/test.php` (no PHPUnit needed for this scale) — Homebrew's `php` cask is sufficient (`brew install php`).

This mirrors the JS-side pattern in `tests/computePlayerStats.test.mjs` (load the live method body, stub the minimum `this` surface, assert against real production code).

---

## Tooltips & Translations

When implementing tooltips in the BGA Modern Framework, be aware of the following conventions:

**1. Tooltip Method Access:**
The `addTooltipHtml` method is exposed on the `GameGui` instance, which is wrapped by the `bga` object. You must call it as `this.bga.gameui.addTooltipHtml(nodeId, html)` inside your client-side class. Do NOT use `this.bga.addTooltipHtml()` or `this.addTooltipHtml()` (which was standard in the legacy framework).

**2. Tooltip HTML Styling:**
To maintain a consistent aesthetic with standard BGA patterns (like *Race for the Galaxy*), structure tooltip HTML as follows:
- Use an `<h3>` tag for the title text.
- Use an `<hr/>` below the title.
- Wrap the body text in a `<div class="cardtooltip">`.
- Wrap secondary or effect text in a `<p class="smalltext">`.

**3. Tooltip Translations:**
Always wrap hardcoded label strings inside the tooltip HTML with the `_("...")` Javascript translation function (e.g., `_("Plant Type")`). This ensures the strings can be parsed and replaced by BGA's built-in translation localization system. Dynamic string variables should generally remain untranslated directly here unless they represent static keywords.
