<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/OSTxMchb "Wire up giveExtraTime() calls"
 *
 * giveExtraTime() was never called anywhere. Per Marty's observation from
 * a live game of Splendor, the standard pattern is: every time it becomes
 * a player's turn to act, they get a standard extra-time bump (BGA's own
 * time bank handles the per-table amount and cap — the game code just
 * calls giveExtraTime($playerId) once per activation).
 *
 * This game has exactly 4 MULTIPLE_ACTIVE_PLAYER states (SetupDecisions,
 * PlantingPhase, WeatherPhaseChoose, WeatherPhaseBonus) — the only states
 * where a player is ever waiting to take an action. Each activates every
 * player via setAllPlayersMultiactive(); Game::giveExtraTimeToAllPlayers()
 * is called right alongside it in every one of the four.
 *
 * Drives the REAL onEnteringState() of all four states (not
 * re-implementations) and confirms every player got exactly one
 * giveExtraTime() call per state entry.
 *
 * Run: php tests/php/GiveExtraTimeTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../plantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherPhaseBonusSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/SetupDecisions.php';
require __DIR__ . '/../../plantopia/modules/php/States/PlantingPhase.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseChoose.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseBonus.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\States\SetupDecisions;
use Bga\Games\Plantopia\States\PlantingPhase;
use Bga\Games\Plantopia\States\WeatherPhaseChoose;
use Bga\Games\Plantopia\States\WeatherPhaseBonus;
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

function freshGame(): Game {
    $game = new Game();
    $game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
    $game->players[2] = ['name' => 'Bob', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
    return $game;
}

echo "--- SetupDecisions gives every player extra time on entry ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;
$state->onEnteringState(0);
check('both players got exactly one giveExtraTime() call', $game->extraTimeGivenTo === [1, 2], json_encode($game->extraTimeGivenTo));

echo "\n--- PlantingPhase gives every player extra time on entry ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;
$state->onEnteringState(0);
check('both players got exactly one giveExtraTime() call', $game->extraTimeGivenTo === [1, 2], json_encode($game->extraTimeGivenTo));

echo "\n--- WeatherPhaseChoose gives every player extra time on entry ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new WeatherPhaseChoose($game);
$state->bga = $bga;
$state->onEnteringState(0);
check('both players got exactly one giveExtraTime() call', $game->extraTimeGivenTo === [1, 2], json_encode($game->extraTimeGivenTo));

echo "\n--- WeatherPhaseBonus gives every player extra time on entry ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new WeatherPhaseBonus($game);
$state->bga = $bga;
$state->onEnteringState(0);
check('both players got exactly one giveExtraTime() call', $game->extraTimeGivenTo === [1, 2], json_encode($game->extraTimeGivenTo));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
