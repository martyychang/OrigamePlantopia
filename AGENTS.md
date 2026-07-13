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
│   │   ├── Game.php                       # Main server-side game class
│   │   ├── PlantCards.php                 # Material data: 33 plant card types
│   │   ├── WeatherCards.php                # Material data: character + bonus weather cards
│   │   ├── CharacterCards.php              # Material data: the 5 characters
│   │   ├── PlantingPlayerSubstate.php      # Per-player substate enum for PlantingPhase — see "Player Substates" below
│   │   ├── WeatherPhaseBonusSubstate.php   # Per-player substate enum for WeatherPhaseBonus
│   │   └── States/                        # One PHP class per game state — every file
│   │       │                              # here MUST extend GameState (see gotcha below)
│   │       ├── SetupDecisions.php          # Mulligan + character claim (id: 20)
│   │       ├── DistributeWeather.php       # Deal character weather cards (id: 13)
│   │       ├── PlantingPhaseStart.php      # Scoring + status reset (id: 29)
│   │       ├── PlantingPhaseUpkeep.php     # Draw 1 card per player (id: 30)
│   │       ├── PlantingPhase.php           # Main planting actions (id: 31)
│   │       ├── WeatherPhaseStart.php       # Weather phase entry
│   │       ├── WeatherPhaseReveal.php      # Reveal public weather cards
│   │       ├── WeatherPhaseChoose.php      # Players choose a weather card
│   │       ├── WeatherPhaseBonus.php       # Play Bonus Weather cards (id: 43)
│   │       ├── WeatherPhaseGrow.php        # Apply growth from chosen + bonus weather
│   │       └── EndScore.php                # Pre-end-game state (id: 98)
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

**Always render actions via `this.bga.statusBar.addActionButton(...)`, never a raw HTML `<button>` built by hand.** `renderDraftModal`'s Confirm button used to be `document.createElement('button')` with a `bga-button` class, appended into a plain `<div>` inside a custom modal — visually an oddly stretched full-width button, unlike every other action in the game (all of which go through the status bar and render as compact, consistently-styled buttons). See https://trello.com/c/YJXNQMHM. For a "don't let them confirm until N items are selected" gate specifically, the established pattern here is to only *call* `addActionButton` once the selection is valid — call `removeActionButtons()` first and conditionally re-add — same as `renderPendingEffect`'s `discard_cards` branch and `WeatherPhaseBonus`'s Done/Skip buttons. That gives the same outcome as a disabled button without this framework needing to expose a disabled-button state.

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
- Standard tables provided by framework: `global`, `stats`, `gamelog`, `player`
- **Four Deck-component tables**, one per card family, all the same shape (`card_id`, `card_type`, `card_type_arg`, `card_location`, `card_location_arg`): `plant_card`, `weather_card`, `character_card`, `planter_card`.
- **Custom `player` columns** (`ALTER TABLE player ADD ...`), each with an inline `COMMENT` naming its value meanings:
  - `player_mulligan_choice` — 0=undecided, 1=keep, 2=redraw
  - `player_planting_status` — the `PlantingPlayerSubstate` enum's sole source of truth (see "Player Substates" below)
  - `player_pending_effects` — JSON array, the effect queue (see "Complex Multi-Step State Machines & Effect Queues")
  - `player_bonus_weather_status` — the `WeatherPhaseBonusSubstate` enum's sole source of truth
  - `player_banana_used` — per-round character-ability flag
- Don't assume "keep it simple, 1–2 tables" as a hard ceiling — this project outgrew that early and it was fine. What matters is each table/column staying single-purpose (see "Player Substates" for a case where sharing one column across two unrelated concepts caused a real bug).
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
- [x] Tiebreaker implemented (aux score) — Trello DTEJePl6: Adult Plants × 1000 + cards-in-hand packed into `player_score_aux`
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
4. **Pause for Input:** When an interactive effect is reached (like `draft_cards` or `discard_cards`), `break` out of the loop, set the player's substate to "resolving effects" (e.g., `PlantingPlayerSubstate::ResolvingEffects->value` — see "Player Substates" below, don't hand-write the raw int), and fire a notification with the current queue to instruct the frontend to render the appropriate UI prompt.
5. **Resolve and Resume:** The frontend calls a corresponding `actResolve*` method (e.g., `actResolveDraft`) which handles the user's input, removes the effect from the front of the queue (`array_shift`), saves the queue, and immediately calls `processPendingEffects()` to resume the chain.
6. **Moot-effect short-circuit:** Before pausing for an interactive effect, check whether the current game state can actually satisfy it. Example: a `level_up` with target `LEVEL_UP_OTHER` is moot if the player has no other plants in their garden (Natural Flower planted as the first flower). Pop moot effects silently and `continue` the loop — never trap the player on an unfulfillable prompt. Centralize the checks in an `isInteractiveEffectMoot($playerId, $effect)` helper so each new effect type has one place to opt in.
7. **Skip button as fallback:** Surface a Skip action (a generic `actSkipPendingEffect` on the server, plus a button on every choice prompt) for *optional* effects (`level_up`, `level_up_family`, `gain_weather`). Gate it server-side with an `isEffectSkippable($effect)` whitelist so forced/penalty effects (e.g., `discard_cards`) and effects with their own bespoke flow (e.g., `banana_offer`'s built-in Skip) aren't accidentally bypassable.
8. **Re-rendering after a status-only change:** Server actions that reset `player_planting_status` and pop the queue (e.g., `actUseBananaAbility` after the player chose to use Banana) must emit a notification that updates the client's local `gamedatas.players[pId].planting_status` AND re-triggers `onEnteringState`. Without it, the client UI remains stuck on the prior prompt even though the server has moved on. The reusable shape is the existing `playerGainedAction` notification — emit it from any action that grants a fresh planting action, and the corresponding `notif_playerGainedAction` handler refreshes `gamedatas` + delegates to `this.plantingPhase.onEnteringState(null, true)`.
9. **`gain_weather` has two distinct shapes — pick the one that matches the card text exactly.** `gain_weather_type` (singular) + `gain_weather_qty` is "gain N cards of [one specific type, OR any type, player's choice if ANY]" (e.g. Pepper Tree: "a Bonus Wind Card"; Geometree: "any Bonus Weather Card"). `gain_weather_types` (plural, an array) is for a card that grants **several DIFFERENT specific types in one effect with no player choice at all** (e.g. Gum Tree: "a Bonus Rain Card AND a Bonus Sun Card") — `queueEffects()` expands it into one queue entry per type (`qty: 1` each), each auto-resolved by the same specific-type auto-grant path (`processPendingEffects()`'s `gain_weather` branch only auto-resolves when `weather_type !== WEATHER_ANY`, so every entry the plural form produces is guaranteed non-interactive). Getting these two confused is exactly what caused https://trello.com/c/L56GTT7Q: Gum Tree used `gain_weather_qty: 2` + `gain_weather_type: WEATHER_ANY` ("gain 2 of the player's choice") when the card text — and the rulebook's "gain **the** 2 Bonus Weather Cards", referring to the two specific cards drawn on the card art — actually meant "gain these two specific ones, automatically." `PlantingEffectKeysTest.php` validates every `gain_weather_types` array is non-empty, contains only recognized weather constants, and never includes `WEATHER_ANY` (which has no meaning as one of several "different specific types" — use the singular form for that).
10. **A typed `gain_weather` effect (singular, `weather_type !== WEATHER_ANY`) never falls back to a different type, even if its own type is exhausted.** RULEBOOK.md's Bonus Weather Cards section has a parenthetical — *"If you get to take a Bonus Weather Card and there are none left of that type, take any other weather card. If none remain, take a Bonus Weather card of your choice from another player"* — that reads, out of context, like it could apply here. It doesn't: that clause is scoped to the Weather Phase mechanic of **playing** a Bonus Weather Card you're already holding (Step 2, "Reveal Weather Cards"), not to Planting Phase card effects that **grant** a specific one (Treegonometree/Tree Tree/Pepper Tree: "gain a Bonus Rain/Sun/Wind Card" — no "or any other type" on the card text itself, confirmed by Marty directly). An earlier version of `processPendingEffects()` implemented the fallback anyway, generalizing that clause to every typed `gain_weather` effect — silently handing a player a *different* weather type than the planted card promised whenever the specific type's pool was empty but the overall market wasn't, and silently dropping the effect with **no notification at all** when the whole market was also empty, leaving the client frozen on a stale "Choose a Bonus Weather card to gain" prompt with nothing to click. Fixed in https://trello.com/c/ngnBJhnS: a typed effect now only ever grants its own exact type or resolves as "none remain" (posting an explicit move message either way) — never widens to `WEATHER_ANY`. `GainWeatherTypeExhaustedTest.php` covers both the "other types still in market" and "market fully empty" cases.

---

## Player Substates

A `MULTIPLE_ACTIVE_PLAYER` state that requires player action is best modeled as each active player independently working through their own **substate machine**, with the shared `GameState` only advancing once every player's substate reaches a concluded value. This is the formalization of the effect-queue pattern above, generalized: `player_planting_status` (Ready / Done / ResolvingEffects) is PlantingPhase's substate; `player_bonus_weather_status` (Deciding / Passed) is WeatherPhaseBonus's.

**Four rules, for minimal room for error** (established while fixing two real bugs this pattern was designed to prevent — see below):

1. **Durable source of truth only.** A player's substate lives in one DB column, never reconstructed by the client from replaying notifications. This is what makes page-reload rendering trustworthy for free — a fresh `getAllDatas()`/`getArgs()` read and the live notification-driven UI both read the exact same column, so they can't disagree.

2. **One named PHP enum per state family, not magic ints.** Define it as a plain `enum ... : int` (`PlantingPlayerSubstate`, `WeatherPhaseBonusSubstate`) with named cases and a doc comment on the column's meaning. Read every DB value through `::from()` (throws on an undefined value — fail fast on drift) rather than casting a raw int.

   > **Gotcha — do NOT put substate enum files in `modules/php/States/`.** BGA Studio's game-creation bootstrap scans every class file in that directory and fatals Express Start if it finds one that doesn't extend `\Bga\GameFramework\States\GameState` ("Class X does not extends \Bga\GameFramework\States\GameState"). A plain enum isn't a GameState — it broke game creation entirely the first time this project tried it. Put substate enums in `modules/php/` directly, alongside `PlantCards.php`/`WeatherCards.php`/`CharacterCards.php` — they're the same kind of thing (a material/data type), not state machine classes.

3. **One funnel to `setPlayerNonMultiactive()` per state.** Every code path that concludes a player's turn (a normal action, a zombie/AFK handler, an effect queue draining to empty) should call one private method (e.g. `markPlayerDone()`) rather than each calling the framework directly — see "MULTIPLE_ACTIVE_PLAYER Deactivation Gotchas" below for what goes wrong if you don't.

4. **Distinguish "start a new top-level action" from "resolve a pending effect" with two different guards.** A player mid-`ResolvingEffects` must be blocked from starting a brand-new action (`actPlant`/`actGrow`/etc.) but must NOT be blocked from the `actResolve*` methods that are the intended way *out* of that substate. Use a stricter guard (reject anything but the Ready case) for the former and a looser one (reject only Done) for the latter — conflating them either traps players who are mid-resolution, or lets them start a second action while the first is still pending, silently interleaving two effect chains on the same queue. This was a real, live bug found while writing this section down, not a hypothetical.

**Don't put two unrelated per-player facts on one column just because they're both readiness gates.** `player_planting_status` and `player_bonus_weather_status` were briefly the same column (`WeatherPhaseBonus` reused `PlantingPhase`'s), and it worked by coincidence — until it wouldn't have (a future third value on either side would collide with the other's meaning). "Finished planting" and "passed on Bonus Weather" are different facts that only share a shape; give each state family its own column and enum.

**This rule has a client-side mirror that's just as easy to violate even after the server-side columns are correctly split** — the DB split alone did NOT prevent https://trello.com/c/DCpOIanp, because the CLIENT still shared one `gamedatas.players[pId].planting_status` field across both states' JS. See "Client-Side: `isCurrentPlayerActive` Is the Only Truth for 'Am I Active'" under "State Transitions & Frontend Synchronization" below.

---

## PHP Division & Math Gotchas

When implementing game rules that require division (e.g., "Gain 1 point for every 2 cards in hand"), be careful with PHP's standard math functions.

- **`ceil($val / 2)`**: Rounds **up**. If a player has 1 card, `ceil(0.5)` equals 1, incorrectly awarding a point.
- **`floor($val / 2)`**: Rounds **down**. This is the correct way to award points for complete sets or pairs.

---

## State Transitions & Frontend Synchronization

**Do NOT perform state-reset DB updates inside `onEnteringState()` of a `MULTIPLE_ACTIVE_PLAYER` state.**
Because of how the BGA framework broadcasts `MULTIPLE_ACTIVE_PLAYER` transitions, `getArgs()` can be evaluated *before or simultaneously with* that state's own `onEnteringState()`. A `DbQuery("UPDATE player SET ... = 0")` executed inside `onEnteringState()` risks `getArgs()` reading the *pre-reset* value and transmitting it to clients.

**Reset in the OUTGOING transition of the state before it instead** (e.g., in `WeatherPhaseReveal::onEnteringState()`, right before `return WeatherPhaseBonus::class;`), or in a dedicated intermediate `GAME` state. By the time the destination `MULTIPLE_ACTIVE_PLAYER` state's own `getArgs()`/`onEnteringState()` run, the DB write already happened in a prior, separate request — no race window.

> **This bit us for real, twice, on the same underlying rule.** `player_planting_status` was fixed to reset in `WeatherPhaseReveal` (not inside `PlantingPhase::onEnteringState()`) early on. `player_bonus_weather_status` was NOT — `WeatherPhaseBonus::onEnteringState()` kept doing `DbQuery("UPDATE player SET player_bonus_weather_status = Deciding")` internally, right up until it caused https://trello.com/c/DCpOIanp: both players saw "Waiting for other players to finish playing Bonus Weather..." the instant the state began, with no action available to either — reproducible live, but a page reload (which always re-derives everything from a fresh, race-free `getAllDatas()`+`setup()`) always "fixed" it, which is exactly the tell for this class of bug. Fixed by moving the reset into `WeatherPhaseReveal::onEnteringState()` alongside the (correctly-placed) `player_planting_status` reset. **When adding a new `MULTIPLE_ACTIVE_PLAYER` state with its own substate column, grep every other such state for this exact pattern before shipping — don't assume the rule was applied everywhere just because it's applied somewhere.**

### Client-Side: `isCurrentPlayerActive` Is the Only Truth for "Am I Active"

The framework passes every `on­EnteringState(args, isCurrentPlayerActive)` / `onPlayerActivationChange(args, isCurrentPlayerActive)` call an `isCurrentPlayerActive` flag — BGA's own authoritative tracking of the current multiactive-player set, maintained by the framework itself, not by this game's code. **Treat it as the sole source of truth for whether to show "Waiting for other players..." vs. real actions.** Do not layer an additional custom-cached "am I done" check on top of it (e.g. `if (!isCurrentPlayerActive) return waiting; ... if (someCachedStatus == 1) return waiting;` — the second check can only ever make things WORSE relative to the framework's own signal, never better, because it's a second, independently-maintained copy of information the framework already tracks correctly).

This is what actually broke in https://trello.com/c/DCpOIanp, independent of (and compounding) the `getArgs()` race above: `WeatherPhaseBonus`'s client class reused `gamedatas.players[pId].planting_status` — a field name and column **owned by the unrelated `PlantingPhase` state** — to track "has this player finished their Bonus Weather decision," and coincidentally both states use the value `1` to mean "done with my current interactive step." Every player reaches `WeatherPhaseBonus` immediately after finishing a real `PlantingPhase` in the same round, leaving `planting_status = 1` for both players the instant `WeatherPhaseBonus` begins — so even a perfectly-timed, race-free reset from the server wasn't the only thing standing between this bug and "always broken every round." Two independent latent bugs (a server-side race that could deliver a stale value, and a client-side field collision that would misinterpret it even if delivered correctly) happened to compound into one very reproducible symptom.

**If you need immediate optimistic feedback right after the player's OWN action** (before the server round-trip confirms it and the framework's own `isCurrentPlayerActive` catches up), use a **private flag scoped to the state class instance** (e.g. `this.justActed = false`, reset in every `onEnteringState`), OR'd with `!isCurrentPlayerActive` in the gate. Never write it to `gamedatas.players[pId]` — that object is shared, long-lived, and (per "Player Substates" above) can be written by other states' notification handlers. A field that's private to one class instance and rebuilt fresh on every entry structurally cannot leak across states or across rounds, no matter what future code gets added elsewhere.

All four `MULTIPLE_ACTIVE_PLAYER` client state classes now follow this: `SetupDecisions` and `WeatherPhaseChoose` were already clean (pure `isCurrentPlayerActive`, no secondary cache — `WeatherPhaseChoose`'s notif handler even hardcodes `isCurrentPlayerActive=false` directly rather than needing a flag at all, since it always means the same thing there). `WeatherPhaseBonus` and `PlantingPhase` both had the redundant-check shape and both now use `justActed` (see `Game.js`) — https://trello.com/c/DCpOIanp fixed the former (a real, reported bug — the field it reused was also owned by the latter, causing the cross-state collision); https://trello.com/c/e55vsa8Q was a proactive hardening pass on the latter (never reported broken — `PlantingPhase` legitimately owns `planting_status`, so there was no cross-state collision — but the same latent single-state race existed: a live `onEnteringState()` running with stale/partial `args` could still let the redundant `status == 1` check override a correct `isCurrentPlayerActive`). `PlantingPhase` keeps reading `planting_status` for exactly one thing the framework signal can't tell you: `status == 3` (`ResolvingEffects`, real synced substate) selects the pending-effect-resolution UI over the normal action-choice UI — that's additional information, not a duplicate "am I active" re-check, so it's untouched by this rule. (`PlantingPlayerSubstate` only ever defines `0`/`1`/`3` — never `2`; the old JS condition's `status == 2` branch was dead code left over from pre-enum days and was removed in the same pass.)

A survey of every other per-player client field (`mulligan_choice`, `pending_effects`, `score`) found none of them shared across more than one state family — `planting_status` was the only one with this shape. If a future field is ever written from more than one state class's notification handlers, that's the signal to ask whether it needs the same treatment.

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

### Client-Side: Data Needed the Instant a State Renders Must Come From `getArgs()`, Not a Notification

A notification fired by an EARLIER, auto-transitioning `GAME` state is not guaranteed to have been processed by the client by the time a LATER state's UI renders. BGA Studio documents that notifications are queued and paced separately from state-transition rendering (for animation purposes), while a state's `getArgs()` is evaluated synchronously as part of entering that exact state. If a `MULTIPLE_ACTIVE_PLAYER` state's UI depends on some `gamedatas` slice being current, and that slice is *only* kept in sync via notifications, there's a window where the state can render before the relevant notification's queued processing has actually landed — the UI looks wrong (missing/stale data) with nothing to repair it until something re-fetches everything synchronously. A page reload always "fixes" it for exactly that reason (`getAllDatas()` + `setup()` bypasses the notification queue entirely) — same tell as the `getArgs()`-race bug above, different mechanism.

This is what caused https://trello.com/c/61uLM9hR: `WeatherPhaseBonus`'s selection UI (https://trello.com/c/Tyxs3bcd) reads `gamedatas.weatherPublicBonus` to build its Sun/Rain/Wind buttons, but that slice was kept in sync *entirely* via notifications — incremental add/delete on gain/play, plus a full resync from the `weatherCleared` notification fired one state earlier by `WeatherPhaseGrow`. A player who played some (not all) held Bonus Weather cards in one round, then reached the next round's `WeatherPhaseBonus`, could see "Play Bonus Weather" but no condition buttons for the cards they still held — `weatherCleared`'s queued processing hadn't caught up yet. Reloading always fixed it.

**Fix: treat this exactly like the player-substate reset rule above — the destination state's own `getArgs()` should return the data fresh, and `onEnteringState()` should resync `gamedatas` from `args` unconditionally, every entry**, rather than trusting whatever a notification already wrote:

```php
// WeatherPhaseBonus.php
public function getArgs(): array
{
    return [
        'weatherPublicBonus' => $this->game->weatherCards->getCardsInLocation('weather_public_bonus'),
    ];
}
```

```javascript
// Game.js — WeatherPhaseBonus
onEnteringState(args, isCurrentPlayerActive) {
    this.selectingBonus = false;
    this.justActed = false;
    if (args && args.weatherPublicBonus !== undefined) {
        this.game.gamedatas.weatherPublicBonus = args.weatherPublicBonus;
    }
    this.onPlayerActivationChange(args, isCurrentPlayerActive);
}
```

This doesn't replace the notification-driven incremental updates (`notif_playerPlayedBonus`, `notif_weatherCleared`, etc.) — those still matter for keeping the UI live and responsive *while a state is already showing*. It adds a synchronous, race-free resync at the one moment (state entry) where staleness is actually visible and otherwise unrecoverable without a reload. **Any `MULTIPLE_ACTIVE_PLAYER` state whose UI depends on a `gamedatas` slice populated by a notification from an earlier state is a candidate for this same treatment** — not just player-substate columns.

**Audit sweep (2026-07-12), all four interactive `MULTIPLE_ACTIVE_PLAYER` client states checked:**

| State | Data its UI needs at entry | Verdict |
| --- | --- | --- |
| `WeatherPhaseBonus` | `weatherPublicBonus` (public) | **Fixed** — the reported bug (https://trello.com/c/61uLM9hR) |
| `WeatherPhaseChoose` | `weatherHand` (private) | **Fixed proactively** — same shape, notification fired a full `PlantingPhase` round earlier |
| `PlantingPhase` | `hand` (private) | **Fixed proactively** — narrowest window of the three (`PlantingPhaseUpkeep` is the *immediately* preceding state, no interactive state in between), fixed anyway for consistency |
| `SetupDecisions` | `mulligan_choice`, `claimedCharacters`/`availableCharacters` | **Not vulnerable, left as-is** — this state runs exactly once per game (not once per round), so there is no "previous round's notification still in flight" scenario for it to race against; the data it reads is set synchronously during game setup, in the same request that produces the very first `gamedatas` payload |

**Private data (`hand`, `weatherHand`) needs BGA's `_private` mechanism, not a top-level `getArgs()` key** — returning it directly would broadcast every player's hand to every other player. Keyed by the requesting player's id, with `_merge_private => true` flattening it into the client's `args` (so `args.hand`, not `args._private.hand` — same flat shape as the public-data case):

```php
public function getArgs(): array
{
    $playerId = (int)$this->game->getCurrentPlayerId();
    return [
        '_private' => [
            $playerId => [
                'hand' => $this->game->plantCards->getCardsInLocation('hand', $playerId),
            ],
        ],
        '_merge_private' => true,
    ];
}
```

> **This was the first use of `_private`/`_merge_private` in this codebase.** `tests/php/PrivateHandGetArgsTest.php` verifies this game's own PHP correctly scopes each player's data to their own id (using two different `$game->currentPlayerId` values and asserting neither player's slice leaks the other's card ids anywhere in the returned structure, including a raw `json_encode` substring check) — but that can only catch a mistake in *this* code, not confirm BGA's real wire delivery matches the documented `_private`/`_merge_private` behavior. **Smoke-test hand privacy on an actual BGA Studio table** (two-player table, confirm each player only ever sees their own hand reflected in `args`) before fully trusting this in production.

---

## MULTIPLE_ACTIVE_PLAYER Deactivation Gotchas

> See "Player Substates" above for the broader pattern this fits into — the rule there ("one funnel to `setPlayerNonMultiactive()` per state") is what keeps the anti-pattern below from creeping back in as a state gains more ways for a player to finish their turn.

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
| `weather_played_bonus` (`location_arg = player_id`) | Played by the player THIS round. Counted toward growth in `WeatherPhaseGrow`, then returned to `bonus_deck`. | Public for the duration of the round — and, since https://trello.com/c/rvSEQag1, rendered as a garden tile (see below). |

Rules:

- **Never** put a Bonus Weather card into `hand`. Bonus weather is public — hand is private.
- All gain paths (Mushroom claim, plant `gain_weather` effects, `actResolveGainWeather`) target `weather_public_bonus`.
- `actPlayBonusWeather` validates the card is in `weather_public_bonus` for the calling player, then moves it to `weather_played_bonus`.
- `WeatherPhaseGrow` reads `weather_played_bonus` for the round's contribution and clears it back to `bonus_deck`. **It does NOT touch `weather_public_bonus`** — held cards persist.
- The end-of-phase `weatherCleared` notification carries the updated `weatherPublicBonus` snapshot so clients re-sync.
- Public gain notifications (`playerGainedWeather`, `playerReceivedWeather`) carry the gained card payload so every client can render the new tile, not just the recipient. Bonus weather card identity is not hidden information.
- The client's `computePlayerStats` counts `weather_public_bonus` only (the *held* count). Cards in `weather_played_bonus` are intentionally excluded because the displayed count should decrement when a card is played.
- **Held Bonus Weather cards (`weather_public_bonus`) are NOT rendered as clickable board tiles** (per https://trello.com/c/uiJWdVTg — counted only, shown via the player panel tally). Choosing which to play is a `WeatherPhaseBonus` client-side status-bar interaction (one button per weather condition still held, same pattern as `WeatherPhaseChoose`'s Sun/Rain/Wind buttons — see `Game.js`), not a click-a-tile interaction. When `uiJWdVTg` removed the tiles, the OLD selection code (``document.getElementById(`weather_${c.id}`)``, highlight, `onclick`) was left behind targeting elements that no longer existed — the `if (el)` guard silently no-opped for every card, so there was no way to select one at all until https://trello.com/c/Tyxs3bcd fixed it. **General lesson: when a fix stops rendering some card/element as a DOM tile, grep for every other place that assumed a tile exists for it (`getElementById`, `querySelector` against that id/class pattern) — a silently-skipped `if (el)` guard turns a rendering change into a silent functional break elsewhere, with no error to catch it.**
- **PLAYED Bonus Weather cards (`weather_played_bonus`) ARE rendered, unlike held ones** — as a garden tile (`garden_weatherbonus_<id>`, `renderPlayedBonusWeather`) appended into the SAME row as the player's planters and character card, landing to the right of the character card since that row is append-only and the character card already renders last (see https://trello.com/c/nBsWlxlT). `applyBonusWeatherPlayed(card, playerId)` is the single funnel for "this card is now played" — it updates `gamedatas` (delete from held, add to played), renders the tile, and refreshes player panels, all in one call. It's called from TWO places for the SAME card: optimistically, the instant `WeatherPhaseBonus`'s status button is clicked (before the server round-trip confirms it — the click has already added the card to that turn's selection, which WILL be submitted, so there's no scenario where it doesn't end up played), and again from `notif_playerPlayedBonus` when the server does confirm. It must therefore be idempotent — `renderPlayedBonusWeather` skips any card id that already has a rendered element. Without the optimistic call, the status button for a condition disappeared immediately on click (correct, established behavior since Tyxs3bcd) while the player panel's held count and the garden tile didn't update until the WHOLE selection was submitted (Done / auto-submit) — two different, out-of-sync stories about the same click. `notif_weatherCleared` removes these tiles once `WeatherPhaseGrow` has moved the cards back to `bonus_deck` server-side. See https://trello.com/c/rvSEQag1.

---

## Shared Component Synchronization & UI State Persistence

When a backend state transition changes a global shared UI component (like removing cards from a public deck), you must explicitly transmit the updated state of that shared component to all clients via `notify->all`. BGA does not automatically sync physical deck locations dynamically if the frontend is unaware.
* **Notification Payloads:** You can include updated global data directly within a transition's or cleanup's notification payload (e.g., `$this->bga->notify->all('weatherCleared', '', ['bonusMarket' => $bonusMarket]);`). This allows the frontend's notification handler to seamlessly re-render shared market areas without requiring a full page refresh.

Additionally, when custom dynamic UI states depend on transient card locations (like a played "bonus weather" card moving into a custom `weather_public_bonus` location), you must:
1. Update the local `this.gamedatas` cache directly within the notification handler (e.g., `notif_playerPlayedBonus`) so the data persists locally during live play.
2. Ensure that the initial `setup(gamedatas)` correctly reads and renders that specific slice of `gamedatas`, merging it with other generic components if necessary. Failure to process this local cache in `setup` will result in visual elements vanishing if the user refreshes the page mid-round.

---

## Notification Handlers Must Clean Up Side-Effect Cards, Not Just the Primary Card

When a server action moves/discards a SECONDARY card as a side effect of the main card's transition — e.g. planting a Treevolved adult by sacrificing an existing Baby (or Treevolved) plant already in the garden — the `notif_*` handler must remove that secondary card's DOM element and `gamedatas` entry too, not just render the primary card. See https://trello.com/c/wVzDccUu (`notif_plantPlanted` in `Game.js`): the server (`PlantingPhase::actPlant`) already discarded the sacrificed plant correctly, and the notification payload already carried its id (`payment_card_ids`), but the client only ever cleaned up HAND entries for those ids — never a GARDEN entry. Renderers like `renderPlantInPlanter` only ever `insertAdjacentHTML('beforeend', ...)` into a slot; they never clear it first. Left alone, the new card visually stacks on top of the still-present old one instead of replacing it.

**Pattern:** for every id in a "these were consumed to pay for this" list, unconditionally try both the hand cleanup AND the on-board cleanup (`delete gamedatas.plantsOnPlanters[id]`, `delete gamedatas.plantsLevel3[id]`, `document.getElementById(...)?.remove()`) — it's safe to run the board cleanup even when the consumed id was actually a hand card, since a hand card was never in `plantsOnPlanters`/`plantsLevel3` to begin with. Regression test: `tests/plantPlantedStaleElement.test.mjs` (drives the real extracted method body through headless Chrome, since DOM removal can't be verified with a plain object-diff test).

---

## Moving a Card Between `gamedatas` Collections Client-Side: Translate Field Meanings, Don't Just Re-Key

When a client `notif_*` handler moves a card's object from one `gamedatas` collection to another (e.g. `plantsOnPlanters` → `plantsLevel3` when a plant graduates to level 3, in `notif_plantGrown`), check whether any field on that object means something *different* depending on which collection it's in. Naively re-keying the same object (`delete collectionA[id]; collectionB[id] = card;`) silently carries the OLD meaning into the NEW collection.

This broke exactly that way in https://trello.com/c/7CO2tan1: `plantsOnPlanters` entries use `location_arg` for "which **planter** this plant sits on" (ownership resolved indirectly: `gamedatas.planters[locationArg].location_arg`), but `plantsLevel3` entries use `location_arg` directly for "which **player** owns this plant" — matching the server's own convention (`moveCard($cardId, 'garden_level3', $playerId)` in `PlantingPhase.php`/`WeatherPhaseGrow.php`). Same field name, different meaning, and `notif_plantGrown`'s client-side move never translated it — the plant kept its stale planter id after graduating. Every "does this belong to me" check downstream that reads `plantsLevel3` entries directly (`computePlayerStats`'s level-3 count, `highlightGardenPlantsForCost`'s Treevolve-sacrifice eligibility) compared that stale planter id against a player id, found no match, and silently excluded the plant — from its own owner's player-panel counts *and* from being selectable as a sacrifice — until something forced a full server resync (reload always "fixed" it, same tell as the notification-timing bugs above, but this one's root cause is a field-translation bug, not a timing race).

**Fix, and the general rule:** when a `notif_*` handler moves a card between two `gamedatas` collections, explicitly set every field whose meaning differs between them to what the DESTINATION collection expects — don't assume re-keying the same object is enough. `notif_plantGrown` now does `card.location_arg = args.player_id;` before storing into `plantsLevel3`, using the id the notification already carries rather than re-deriving it.

**Related, separate bug found and fixed in the same notification:** a plant card's "Level: N" text badge is baked into the element's `innerHTML` once, by `plantCardBody`, at PLANTING time (`Level: 0`) — the `data-level` attribute update that happens on every growth step only drives the *on-planter* sliding-reveal CSS animation, it never touches that baked-in text. **General lesson: swapping a DOM element's attributes or CSS classes to change its visual treatment does not refresh any text that was baked into that element's `innerHTML` at an earlier render — if the new treatment needs different text, regenerate it explicitly** (`el.innerHTML = plantCardBody(...).inner`), the same render call `setup()`'s own level-3 rendering already uses for a fresh page load.

The first pass at this fix (7CO2tan1) only regenerated the badge inside `notif_plantGrown`'s `if (args.max_level)` branch — i.e. only for the transition where a plant graduates off its planter to a tilted level-3 tile. That fixed the tilted case but left every intermediate growth step (0→1, 1→2, still on the planter) badge-frozen at "Level: 0", which is exactly the narrower bug Marty then reported separately as https://trello.com/c/UlEhJIr5. **Lesson: when a fix regenerates baked-in text/markup in response to a state change, make sure it covers every transition that changes the underlying value, not just the one transition the original bug report happened to describe** — grep for every place the value can change, not just the one you're staring at. Fixed by moving the regeneration to run unconditionally whenever the DOM element exists, immediately after the `data-level` update, before the `max_level`-specific branch.

Regression tests: `tests/level3PlantGrowth.test.mjs` — drives the real `notif_plantGrown`/`computePlayerStats`/`PlantingPhase.highlightGardenPlantsForCost` through headless Chrome, confirms all three max_level-transition symptoms (wrong level label, undercounted player panel, ineligible as a sacrifice) reproduce against the pre-fix code and are fixed post-fix. `tests/intermediatePlantGrowthBadge.test.mjs` covers the narrower badge-only regression for the 0→1 and 1→2 transitions while still on a planter.

---

## Append-Only Shared Containers Need ONE Canonical Insertion Order Across Every Code Path

When two different code paths both append into the same DOM container — e.g. `setup()` on page load/reload vs. a live `notif_*` handler during play — insertion order (and therefore left-to-right visual order) is whatever order that specific path happened to call things in. If `setup()` and the live notification populate the container in a different order, the same end state (say, N planters + 1 claimed character) renders differently depending on which path last built it, and it looks like a nondeterministic bug even though each path is individually correct. See https://trello.com/c/nBsWlxlT: `setup()` called `renderCharacters()` before `renderPlanters()` into the shared per-player row (`player-garden-planters-<id>`), so a page load put the character card first (left of the planters). But `notif_characterClaimed` does `garden.appendChild(cardEl)` AFTER planters already exist in that row, putting it last (right of the planters) for a character claimed live during play — hence one player's character card sat on a different side than the other's.

**Pattern:** pick the notification handler's order as canonical (it's the one that fires during live play, so it's the order players actually see most), and make every other code path that populates the same container — most commonly `setup()` — match it exactly. Regression test: `tests/characterCardPlacement.test.mjs` (extracts the real per-player render block plus the real render helpers, runs them through headless Chrome, and asserts final child order).

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

**4. Route every render site for a card family through the SAME body-builder helper, not a bespoke copy.** `weatherCardBody(card, cardInfo)` already knows how to emit sprite class + data-attrs for every weather card type (bonus and character alike) and is used correctly by the hand and bonus-market renderers. `renderPublicWeather()` predated it and had its own hardcoded `<strong>${cardInfo.name}</strong>` text-only rendering instead of calling it — so a character weather card (e.g. Carrot Rain) landing in the public weather area showed as a name in a box instead of art, even though the exact same card type already rendered correctly everywhere else. See https://trello.com/c/rwdYylsO. When a card family gets sprite support, grep for every place that renders that family's cards (`weather_${card.id}`, `card_${card.id}`, etc.) and confirm they all call the shared helper — a card type can be "fixed" in one render path and still broken in another.

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

**Table-driven audit tests catch a whole class of bug at once, not just the one instance someone reported.** `PlantingEffectKeysTest.php`/`BonusScoringKeysTest.php` iterate every card's material data (`PlantCards::getTypes()`) and assert every `planting_effect`/`bonus_scoring`/`treat_as` key is one the engine actually recognizes. This is the general form of the bug that made https://trello.com/c/xGkeMcXO possible — a card's data referenced a value the handling code silently didn't wire up — generalized to all 33 cards instead of relying on someone noticing one broken card in play-testing. Worth reaching for this shape whenever a bug turns out to be "the data says X but the code handling X doesn't fully agree": don't just fix and test the one card, write a test that iterates the whole catalog and would have caught it regardless of which card hit it first.

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
