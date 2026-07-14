<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/NhQj58Lk "Implement getGameProgression()"
 *
 * Per Marty's spec on the card (and RULEBOOK.md: "The game ends immediately
 * after the Weather phase if any player has 4 Adult plants ... in their
 * garden"), progression is the MAX number of Adult (Treevolved) plants
 * across all players, mapped 0/1/2/3/4+ -> 0%/25%/50%/75%/100%.
 *
 * Game::countTreevolvedPlants() is shared between getGameProgression() and
 * WeatherPhaseGrow's endgame_triggered check (previously duplicated
 * inline in WeatherPhaseGrow.php) — this test drives both the real
 * Game::getGameProgression()/countTreevolvedPlants() and the real
 * WeatherPhaseGrow endgame check to confirm they agree.
 *
 * Run: php tests/php/GameProgressionTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/WeatherPhaseGrow.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;
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

// ── 0 Adult Plants anywhere -> 0% ──
echo "--- no Adult Plants yet ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->players[2] = ['name' => 'Bob', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->plantCards->seed('Cutetus', 0, 'hand', 1, 3); // Baby plants only, no Adults
check('countTreevolvedPlants is 0 for a player with only Baby Plants', $game->countTreevolvedPlants(1) === 0);
check('getGameProgression() is 0%', $game->getGameProgression() === 0, 'got=' . $game->getGameProgression());

// ── Alice has 2 Adult Plants (1 on a planter growing, 1 already at level 3), Bob has 1 ──
echo "\n--- Alice has 2 Adult Plants (mixed: on-planter + garden_level3), Bob has 1 ---\n";
[$planterA] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
[$bufftusOnPlanter] = $game->plantCards->seed('Bufftus', 1, 'planter', 0, 1); // Treevolved Cactus, still growing
$game->plantCards->cards[$bufftusOnPlanter]['location_arg'] = $planterA;

[$geometreeLvl3] = $game->plantCards->seed('Geometree', 3, 'garden_level3', 1, 1); // Treevolved Tree, already graduated

[$planterB] = $game->planterCards->seed('planter', 0, 'garden', 2, 1);
[$bufftusB] = $game->plantCards->seed('Bufftus', 0, 'planter', 0, 1);
$game->plantCards->cards[$bufftusB]['location_arg'] = $planterB;

check('Alice has 2 Treevolved plants', $game->countTreevolvedPlants(1) === 2, 'got=' . $game->countTreevolvedPlants(1));
check('Bob has 1 Treevolved plant', $game->countTreevolvedPlants(2) === 1, 'got=' . $game->countTreevolvedPlants(2));
check('getGameProgression() is 50% (max=2 -> 2*25)', $game->getGameProgression() === 50, 'got=' . $game->getGameProgression());

// A Baby Plant on a planter or at garden_level3 must NOT count as Treevolved.
[$cutetusOnPlanterA] = $game->plantCards->seed('Cutetus', 1, 'planter', 0, 1);
$game->plantCards->cards[$cutetusOnPlanterA]['location_arg'] = $planterA;
check('a Baby Plant on a planter does not inflate the Treevolved count', $game->countTreevolvedPlants(1) === 2, 'got=' . $game->countTreevolvedPlants(1));

// ── Alice reaches 4 Adult Plants -> 100%, and matches WeatherPhaseGrow's endgame trigger ──
echo "\n--- Alice reaches 4 Adult Plants: 100% progression AND endgame triggers ---\n";
[$planterA2] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
[$carnationA] = $game->plantCards->seed('Carnation', 2, 'planter', 0, 1); // Treevolved Flower
$game->plantCards->cards[$carnationA]['location_arg'] = $planterA2;

[$planterA3] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
[$impossibleTreeA] = $game->plantCards->seed('Impossible Tree', 0, 'planter', 0, 1); // Treevolved Tree
$game->plantCards->cards[$impossibleTreeA]['location_arg'] = $planterA3;

check('Alice now has 4 Treevolved plants', $game->countTreevolvedPlants(1) === 4, 'got=' . $game->countTreevolvedPlants(1));
check('getGameProgression() caps at 100%', $game->getGameProgression() === 100, 'got=' . $game->getGameProgression());

$bga = new BgaStub();
$state = new WeatherPhaseGrow($game);
$state->bga = $bga;
$next = $state->onEnteringState(0);

check('WeatherPhaseGrow triggers endgame (returns EndScore) once a player hits 4 Treevolved plants', $next === \Bga\Games\OrigamePlantopia\States\EndScore::class, 'got=' . $next);
check('endgame_triggered flag was set', (int)$game->getGameStateValue('endgame_triggered') === 1);

// A 5th Adult Plant must not push progression past 100%.
[$planterA4] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
[$squareRootA] = $game->plantCards->seed('Square Root of Tree', 0, 'planter', 0, 1);
$game->plantCards->cards[$squareRootA]['location_arg'] = $planterA4;
check('a 5th Adult Plant still caps progression at 100%, not 125%', $game->getGameProgression() === 100, 'got=' . $game->getGameProgression());

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
