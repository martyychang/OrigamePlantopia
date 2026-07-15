<?php
declare(strict_types=1);

/**
 * Regression/coverage test for WeatherPhaseBonus's player substate, split
 * onto its own player_bonus_weather_status column + WeatherPhaseBonusSubstate
 * enum (previously shared player_planting_status with PlantingPhase — see
 * "Player substates — pattern & rules" in the BGA Studio State Machine doc
 * for why that was rejected). Covers the centralized markPlayerPassed()
 * funnel and the multi-player "wait for everyone" gate, none of which had
 * any test coverage before this state existed on its own column.
 *
 * Run: php tests/php/WeatherPhaseBonusSubstateTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherPhaseBonusSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseBonus.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseReveal.php';
// Note: WeatherPhaseGrow.php is intentionally NOT required — WeatherPhaseBonus
// only references WeatherPhaseGrow::class as a ::class literal (a compile-time
// string), which doesn't need the class to actually be loaded.

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\States\WeatherPhaseBonus;
use Bga\Games\Plantopia\States\WeatherPhaseReveal;
use Bga\Games\Plantopia\WeatherPhaseBonusSubstate;
use Bga\GameFramework\BgaStub;
use Bga\GameFramework\UserException;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    if ($cond) {
        echo "  ok  — $label\n";
    } else {
        echo "  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n";
        $failures++;
    }
}

// ── Regression coverage for https://trello.com/c/DCpOIanp: "both players
// stuck waiting" — root cause was WeatherPhaseBonus::onEnteringState()
// resetting player_bonus_weather_status INSIDE a MULTIPLE_ACTIVE_PLAYER
// state's own onEnteringState(), racing with getArgs() per "State
// Transitions & Frontend Synchronization" in AGENTS.md. The reset now
// happens in WeatherPhaseReveal (the OUTGOING transition into
// WeatherPhaseBonus) instead — same fix already applied to
// player_planting_status. ──
echo "--- reset happens in WeatherPhaseReveal, NOT in WeatherPhaseBonus::onEnteringState() ---\n";
$revealGame = new Game();
// Stale Passed values, as if left over from a previous round's
// WeatherPhaseBonus — exactly what a real table has heading into this
// transition every round after the first.
$revealGame->players[1] = ['name' => 'Alice', 'player_planting_status' => 1, 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Passed->value];
$revealGame->players[2] = ['name' => 'Bob', 'player_planting_status' => 1, 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Passed->value];
$revealGame->currentPlayerId = 1;
$revealGame->weatherCards->seed('carrot', 1, 'weather_chosen', 1, 1);
$revealGame->weatherCards->seed('potato', 0, 'weather_chosen', 2, 1);

$revealBga = new BgaStub();
$revealState = new WeatherPhaseReveal($revealGame);
$revealState->bga = $revealBga;
$next = $revealState->onEnteringState(0);

check('WeatherPhaseReveal resets player_bonus_weather_status to Deciding for every player',
    (int)$revealGame->players[1]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value
    && (int)$revealGame->players[2]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value);
check('WeatherPhaseReveal also still resets player_planting_status (existing behavior, unchanged)',
    (int)$revealGame->players[1]['player_planting_status'] === 0 && (int)$revealGame->players[2]['player_planting_status'] === 0);
check('WeatherPhaseReveal transitions to WeatherPhaseBonus', $next === WeatherPhaseBonus::class);

// Now prove WeatherPhaseBonus::onEnteringState() itself does NOT touch the
// column — the fix moved the write out of it entirely, so calling it
// directly on already-Deciding data must be a complete no-op for this
// column (nothing left to accidentally race with getArgs() on).
$bonusOnlyState = new WeatherPhaseBonus($revealGame);
$bonusOnlyState->bga = $revealBga;
$revealGame->players[1]['player_bonus_weather_status'] = WeatherPhaseBonusSubstate::Passed->value;
$bonusOnlyState->onEnteringState(0);
check('WeatherPhaseBonus::onEnteringState() does NOT reset player_bonus_weather_status (that is WeatherPhaseReveal\'s job now)',
    (int)$revealGame->players[1]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Passed->value);

// ── Regression coverage for https://trello.com/c/61uLM9hR: "no way to
// select a bonus weather card until page reload" — getArgs() must return
// fresh weather_public_bonus data synchronously as part of entering this
// state, rather than leaving the client to rely entirely on the
// weatherCleared notification (fired one state earlier, by
// WeatherPhaseGrow) having already been processed. BGA paces notifications
// separately from state-transition rendering; a page reload always worked
// because it re-fetches everything synchronously via getAllDatas(), which
// is exactly what getArgs() now also does for this state. ──
echo "\n--- getArgs() returns fresh weather_public_bonus data ---\n";
$argsGame = new Game();
$argsGame->players[7] = ['name' => 'Carol', 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Deciding->value];
[$sunCardId] = $argsGame->weatherCards->seed('bonus', 0, 'weather_public_bonus', 7, 1);
[$rainCardId] = $argsGame->weatherCards->seed('bonus', 1, 'weather_public_bonus', 7, 1);
// A card belonging to a DIFFERENT player must also come back — every
// player's held bonus weather is public (see "Bonus Weather Card
// Locations" in AGENTS.md) — proving no locationArg filter was
// accidentally added when this method started returning real data.
[$otherPlayerCardId] = $argsGame->weatherCards->seed('bonus', 2, 'weather_public_bonus', 12, 1);

$argsState = new WeatherPhaseBonus($argsGame);
$argsState->bga = new BgaStub();
$args = $argsState->getArgs();

check('getArgs() returns a weatherPublicBonus key', array_key_exists('weatherPublicBonus', $args));
check('getArgs() includes the Sun card', array_key_exists($sunCardId, $args['weatherPublicBonus'] ?? []));
check('getArgs() includes the Rain card', array_key_exists($rainCardId, $args['weatherPublicBonus'] ?? []));
check('getArgs() includes the OTHER player\'s card too (no locationArg filter)', array_key_exists($otherPlayerCardId, $args['weatherPublicBonus'] ?? []));

// ── Two players; player 1 passes immediately, player 2 plays a card then is auto-passed ──
echo "\n--- normal play: pass / play-then-auto-pass / double-pass rejected ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Deciding->value];
$game->players[2] = ['name' => 'Bob', 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Deciding->value];
$game->currentPlayerId = 1;

[$bonusCardId] = $game->weatherCards->seed('bonus', 0, 'weather_public_bonus', 2, 1);

$bga = new BgaStub();
$state = new WeatherPhaseBonus($game);
$state->bga = $bga;

$state->onEnteringState(0);
check('onEnteringState leaves an already-Deciding player as Deciding (no-op, not a reset)', (int)$game->players[1]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value && (int)$game->players[2]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value);

// Player 1 passes without playing anything.
$game->currentPlayerId = 1;
$state->actPassBonus();
check('player 1 is Passed after actPassBonus', (int)$game->players[1]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Passed->value);
check('state has NOT advanced yet — player 2 still Deciding', (int)$game->players[2]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value);

$threw = false;
try {
    $game->currentPlayerId = 1;
    $state->actPassBonus();
} catch (UserException $e) {
    $threw = true;
}
check('a second actPassBonus() from an already-passed player is rejected', $threw);

// Player 2 plays their one Bonus Weather card, which auto-passes them.
$game->currentPlayerId = 2;
$state->actPlayBonusWeather((string)$bonusCardId);
check('playing a card auto-passes the player (no separate actPassBonus needed)', (int)$game->players[2]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Passed->value);
check('the played card moved to weather_played_bonus', $game->weatherCards->getCard($bonusCardId)['location'] === 'weather_played_bonus');

$notifNames = array_map(fn($e) => $e['name'], $bga->notify->log);
check('server sent "playerPlayedBonus"', in_array('playerPlayedBonus', $notifNames, true));

// ── zombie() forces conclusion regardless of what the player was doing ──
echo "\n--- zombie/AFK forces a player to Passed ---\n";
$game2 = new Game();
$game2->players[1] = ['name' => 'Alice', 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Deciding->value];
$game2->players[2] = ['name' => 'Bob', 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Deciding->value];
$game2->currentPlayerId = 1;
$bga2 = new BgaStub();
$state2 = new WeatherPhaseBonus($game2);
$state2->bga = $bga2;

$state2->zombie(1);
check('zombie(1) forces player 1 to Passed', (int)$game2->players[1]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Passed->value);
check('player 2 (not zombied) is still Deciding', (int)$game2->players[2]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
