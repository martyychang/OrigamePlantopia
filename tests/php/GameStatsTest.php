<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/7kdTOK4l
 * "Define and track meaningful stats.jsonc entries"
 *
 * Per Marty's spec on the card:
 *   - One table statistic: "Total rounds" (one round = one completed
 *     Planting Phase + one completed Weather Phase).
 *   - Player statistics should match all the stats already displayed in
 *     the player panel (Game.js computePlayerStats()): hand count, Bonus
 *     Weather cards held by type, and garden plant counts by family and
 *     maturity.
 *
 * Both are updated once per round, at the end of WeatherPhaseGrow. This
 * drives the REAL Game::updatePlayerPanelStats() and the REAL
 * WeatherPhaseGrow.onEnteringState() (not re-implementations) via the
 * test harness's fake Game/TableStats/PlayerStats.
 *
 * Run: php tests/php/GameStatsTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/WeatherPhaseGrow.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;
use Bga\Games\OrigamePlantopia\WeatherCards;
use Bga\Games\OrigamePlantopia\States\WeatherPhaseGrow;
use Bga\GameFramework\BgaStub;

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

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->players[2] = ['name' => 'Bob', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];

// Alice: 2 cards in hand, 1 Baby Cactus on a planter, 1 Bonus Sun card held.
$game->plantCards->seed('Cutetus', 0, 'hand', 1, 2);
[$planterA] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
[$cutetusA] = $game->plantCards->seed('Cutetus', 0, 'planter', 0, 1);
$game->plantCards->cards[$cutetusA]['location_arg'] = $planterA;
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_SUN, 'weather_public_bonus', 1, 1);

// Bob: 3 cards in hand, 1 Adult (Treevolved) Tree at garden_level3, 2 Bonus Rain cards held.
$game->plantCards->seed('Cutetus', 0, 'hand', 2, 3);
$game->plantCards->seed('Geometree', 3, 'garden_level3', 2, 1);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_RAIN, 'weather_public_bonus', 2, 2);

// ── Table/player stats start at 0 before any round completes ──
echo "--- stats before init ---\n";
check('total_rounds starts at 0 (not yet init()ed by this test)', $game->tableStats->get('total_rounds') === 0);

// ── Simulate setupNewGame()'s init step ──
$game->tableStats->init('total_rounds', 0);
$game->playerStats->init([
    'hand_count', 'bonus_weather_sun', 'bonus_weather_rain', 'bonus_weather_wind',
    'baby_cactus_count', 'adult_cactus_count', 'baby_flower_count', 'adult_flower_count',
    'baby_tree_count', 'adult_tree_count',
], 0);
$game->updatePlayerPanelStats();

echo "\n--- player panel stats match the actual garden/hand state ---\n";
check('Alice hand_count = 2', $game->playerStats->get('hand_count', 1) === 2, 'got=' . $game->playerStats->get('hand_count', 1));
check('Alice baby_cactus_count = 1', $game->playerStats->get('baby_cactus_count', 1) === 1);
check('Alice bonus_weather_sun = 1', $game->playerStats->get('bonus_weather_sun', 1) === 1);
check('Alice bonus_weather_rain = 0', $game->playerStats->get('bonus_weather_rain', 1) === 0);
check('Bob hand_count = 3', $game->playerStats->get('hand_count', 2) === 3);
check('Bob adult_tree_count = 1 (Geometree, Treevolved, at garden_level3)', $game->playerStats->get('adult_tree_count', 2) === 1);
check('Bob bonus_weather_rain = 2', $game->playerStats->get('bonus_weather_rain', 2) === 2);
check('Bob baby_cactus_count = 0 (Bob has no cactus)', $game->playerStats->get('baby_cactus_count', 2) === 0);

// ── One full round (WeatherPhaseGrow) increments total_rounds by exactly 1 ──
echo "\n--- WeatherPhaseGrow completing increments total_rounds and refreshes player stats ---\n";
$bga = new BgaStub();
$state = new WeatherPhaseGrow($game);
$state->bga = $bga;
$state->onEnteringState(0);

check('total_rounds is now 1 after one completed Weather Phase', $game->tableStats->get('total_rounds') === 1, 'got=' . $game->tableStats->get('total_rounds'));

// Alice draws a card mid-round, then another full round completes — stats must track the change.
$game->plantCards->seed('Cutetus', 0, 'hand', 1, 1); // Alice's hand grows to 3
$state->onEnteringState(0);
check('total_rounds is now 2 after a second completed Weather Phase', $game->tableStats->get('total_rounds') === 2, 'got=' . $game->tableStats->get('total_rounds'));
check('Alice hand_count updated to 3 after the second round refresh', $game->playerStats->get('hand_count', 1) === 3, 'got=' . $game->playerStats->get('hand_count', 1));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
