<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/Ir4kdb7k
 * "When planting an adult plant, other adult plants should not be presented for selection"
 *
 * Repro: with a level-2 Buttercup (a BABY flower) and a level-3 Firecracker
 * Flower (an ADULT / Treevolved flower) in the garden, planting an Arrowhead
 * (Treevolved flower, cost 2, cost_unit BABY_FLOWER) offered BOTH as sacrifice
 * candidates. The rulebook is explicit: "Adult Plants require you to pay a Baby
 * Plant from your Garden of a specific type and a minimum Level." An already-
 * Treevolved plant is never a valid sacrifice.
 *
 * The server used to accept any plant of the matching FAMILY (baby or adult).
 * Fixed to require the sacrificed plant's plant_type to equal the cost_unit
 * (which is always the required baby type), enforcing both family and baby-only
 * in one check.
 *
 * Drives the REAL PlantCards.php / PlantingPhase.php against harness.php.
 * Run: php tests/php/TreevolveSacrificeBabyOnlyTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\States\PlantingPhase;
use Bga\GameFramework\BgaStub;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    echo ($cond ? "  ok  — $label\n" : ("  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n"));
    if (!$cond) $failures++;
}

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

// Sanity on the fixture cards: Buttercup is a BABY flower, Firecracker Flower
// is an ADULT (Treevolved) flower, Arrowhead is the Treevolved flower we plant.
echo "--- fixture sanity ---\n";
check("Buttercup is a Baby flower", Game::$PLANT_CARD_TYPES['Buttercup']['plant_type'] === PlantCards::BABY_FLOWER);
check("Firecracker Flower is a Treevolved flower", Game::$PLANT_CARD_TYPES['Firecracker Flower']['plant_type'] === PlantCards::TRV_FLOWER);
check("Arrowhead cost_unit is BABY_FLOWER", Game::$PLANT_CARD_TYPES['Arrowhead']['cost_unit'] === PlantCards::BABY_FLOWER);

function freshGame(): array {
    $game = new Game();
    $game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => '0', 'player_banana_used' => 0];
    $game->currentPlayerId = 1;
    $game->plantCards->seed('Cutetus', 0, 'deck', 0, 40);
    [$arrowId] = $game->plantCards->seed('Arrowhead', 0, 'hand', 1, 1);          // Treevolved flower to plant (cost 2)
    [$planterA] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
    [$planterB] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
    [$buttercupId]  = $game->plantCards->seed('Buttercup', 2, 'planter', $planterA, 1);          // Baby flower, level 2 (valid)
    [$firecrackerId] = $game->plantCards->seed('Firecracker Flower', 3, 'planter', $planterB, 1); // Adult flower, level 3 (invalid)
    $state = new PlantingPhase($game);
    $state->bga = new BgaStub();
    return [$game, $state, $arrowId, $planterA, $planterB, $buttercupId, $firecrackerId];
}

// ── 1. Sacrificing an ADULT (Treevolved) flower is REJECTED ──
echo "--- sacrificing an adult plant is rejected ---\n";
[$game, $state, $arrowId, $planterA, $planterB, $buttercupId, $firecrackerId] = freshGame();
$err = null;
try {
    $state->actPlant($arrowId, $planterB, (string)$firecrackerId);
} catch (\Throwable $e) {
    $err = get_class($e) . ': ' . $e->getMessage();
}
check('actPlant sacrificing the Treevolved Firecracker Flower throws', $err !== null, (string)$err);
check('the adult Firecracker Flower was NOT discarded', $game->plantCards->getCard($firecrackerId)['location'] === 'planter');
check('the Arrowhead was NOT planted (still in hand)', $game->plantCards->getCard($arrowId)['location'] === 'hand');

// ── 2. Sacrificing the matching BABY flower at min level is ACCEPTED ──
echo "--- sacrificing a qualifying baby plant succeeds ---\n";
[$game, $state, $arrowId, $planterA, $planterB, $buttercupId, $firecrackerId] = freshGame();
$err = null;
try {
    $state->actPlant($arrowId, $planterA, (string)$buttercupId);
} catch (\Throwable $e) {
    $err = get_class($e) . ': ' . $e->getMessage();
}
check('actPlant sacrificing the level-2 Baby Buttercup does not throw', $err === null, (string)$err);
check('the Baby Buttercup was discarded', $game->plantCards->getCard($buttercupId)['location'] === 'discard');
check('the Arrowhead was planted on the vacated planter', $game->plantCards->getCard($arrowId)['location'] === 'planter');

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
