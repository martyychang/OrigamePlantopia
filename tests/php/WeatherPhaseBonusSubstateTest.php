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
require __DIR__ . '/../../origameplantopia/modules/php/WeatherPhaseBonusSubstate.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/WeatherPhaseBonus.php';
// Note: WeatherPhaseGrow.php is intentionally NOT required — WeatherPhaseBonus
// only references WeatherPhaseGrow::class as a ::class literal (a compile-time
// string), which doesn't need the class to actually be loaded.

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\States\WeatherPhaseBonus;
use Bga\Games\OrigamePlantopia\WeatherPhaseBonusSubstate;
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

// ── Two players; player 1 passes immediately, player 2 plays a card then is auto-passed ──
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Deciding->value];
$game->players[2] = ['name' => 'Bob', 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Deciding->value];
$game->currentPlayerId = 1;

[$bonusCardId] = $game->weatherCards->seed('bonus', 0, 'weather_public_bonus', 2, 1);

$bga = new BgaStub();
$state = new WeatherPhaseBonus($game);
$state->bga = $bga;

$state->onEnteringState(0);
check('onEnteringState resets every player to Deciding', (int)$game->players[1]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value && (int)$game->players[2]['player_bonus_weather_status'] === WeatherPhaseBonusSubstate::Deciding->value);

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
