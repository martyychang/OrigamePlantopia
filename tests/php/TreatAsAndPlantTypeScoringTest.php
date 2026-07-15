<?php
declare(strict_types=1);

/**
 * Systematic card-by-card audit (Marty's request): functional coverage
 * for two end-game scoring mechanics that had no direct test before this
 * audit, even though the generic per_two_cards_in_hand/per_level3 paths
 * were already covered by BattusScoringTest.php:
 *
 *   - treat_as: Dogtus/Potted Planted Potted Plants/Symmetree each "count
 *     as 2" of their Treevolved family for every OTHER card's per_trv_*
 *     bonus_scoring (e.g. Cactie's "2 points per Treevolved Cactus").
 *   - per_plant_type: Bufftus/Firecracker Flower/Treenity score per
 *     UNIQUE plant family present in the garden (own card included),
 *     which must NOT be inflated by treat_as (that's a count-of-cards
 *     multiplier, not a count-of-types multiplier).
 *
 * Drives the REAL PlantCards.php against Game::calculateAllScores() (the
 * verbatim copy in harness.php — see its docblock for why).
 *
 * Run: php tests/php/TreatAsAndPlantTypeScoringTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;

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

// ── treat_as: Dogtus (counts as 2 Treevolved Cacti) + Cactie (2 pts per Treevolved Cactus/Flower) ──
echo "--- treat_as feeds sibling cards' per_trv_* bonus_scoring ---\n";
$game = new Game();
$game->bga = new \Bga\GameFramework\BgaStub();
$playerId = 1;
$game->players[$playerId] = ['name' => 'Alice'];

[$planterA] = $game->planterCards->seed('planter', 0, 'garden', $playerId, 1);
[$dogtusId] = $game->plantCards->seed('Dogtus', 0, 'planter', $planterA, 1); // level 0 -> 0 points_per_level

[$planterB] = $game->planterCards->seed('planter', 0, 'garden', $playerId, 1);
[$cactieId] = $game->plantCards->seed('Cactie', 0, 'planter', $planterB, 1); // level 0 -> 0 points_per_level

$scores = $game->calculateAllScores();
// Dogtus (treat_as trv_cactus=>2) + Cactie's own default 1 = 3 total trv_cactus.
// Cactie's bonus_scoring: per_trv_cactus=2 -> 3*2=6. per_trv_flower=2 -> 0 flowers -> 0. Dogtus itself scores nothing extra.
check('Dogtus\'s "counts as 2" is picked up by Cactie\'s per_trv_cactus bonus (expected 6)', (int)round($scores[$playerId]) === 6, 'got ' . ($scores[$playerId] ?? 'null'));

// ── treat_as: Symmetree (counts as 2 Treevolved Trees) + Boba Tree (2 pts per Baby/Treevolved Tree) ──
echo "\n--- treat_as: Symmetree + Boba Tree ---\n";
$game2 = new Game();
$game2->bga = new \Bga\GameFramework\BgaStub();
$game2->players[$playerId] = ['name' => 'Alice'];

[$planterC] = $game2->planterCards->seed('planter', 0, 'garden', $playerId, 1);
[$symId] = $game2->plantCards->seed('Symmetree', 0, 'planter', $planterC, 1);
[$planterD] = $game2->planterCards->seed('planter', 0, 'garden', $playerId, 1);
[$bobaId] = $game2->plantCards->seed('Boba Tree', 0, 'planter', $planterD, 1);

$scores2 = $game2->calculateAllScores();
// Symmetree (treat_as trv_tree=>2) + Boba Tree's own default 1 = 3 total trv_tree, 0 baby_tree.
// Boba Tree's bonus_scoring: per_baby_tree=2 -> 0. per_trv_tree=2 -> 3*2=6.
check('Symmetree\'s "counts as 2" is picked up by Boba Tree\'s per_trv_tree bonus (expected 6)', (int)round($scores2[$playerId]) === 6, 'got ' . ($scores2[$playerId] ?? 'null'));

// ── per_plant_type: counts UNIQUE families present, unaffected by treat_as ──
echo "\n--- per_plant_type counts unique families, not weighted by treat_as ---\n";
$game3 = new Game();
$game3->bga = new \Bga\GameFramework\BgaStub();
$game3->players[$playerId] = ['name' => 'Alice'];

foreach (['Cutetus' => null, 'Buttercup' => null, 'Gum Tree' => null] as $type => $_) {
    [$planter] = $game3->planterCards->seed('planter', 0, 'garden', $playerId, 1);
    $game3->plantCards->seed($type, 0, 'planter', $planter, 1);
}
// Bufftus itself is a 4th unique type (trv_cactus) alongside baby_cactus/baby_flower/baby_tree above.
[$planterBufftus] = $game3->planterCards->seed('planter', 0, 'garden', $playerId, 1);
$game3->plantCards->seed('Bufftus', 0, 'planter', $planterBufftus, 1);
// Add a second Baby Cactus (Cattus) to confirm duplicate TYPES within the
// same family don't inflate the UNIQUE-type count.
[$planterExtra] = $game3->planterCards->seed('planter', 0, 'garden', $playerId, 1);
$game3->plantCards->seed('Cattus', 0, 'planter', $planterExtra, 1);

$scores3 = $game3->calculateAllScores();
// 4 unique plant_type values present: baby_cactus, baby_flower, baby_tree, trv_cactus. Bufftus: per_plant_type=2 -> 4*2=8.
check('Bufftus scores 2 pts per unique family present (4 families -> 8, not inflated by the 2nd Baby Cactus)', (int)round($scores3[$playerId]) === 8, 'got ' . ($scores3[$playerId] ?? 'null'));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
