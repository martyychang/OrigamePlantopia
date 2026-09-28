<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/bbJp2j8q
 * "More detailed score breakdown for players at end of game"
 *
 * calculateAllScores() now publishes a per-player end-game score breakdown as
 * BGA stats: per family (tree/flower/cactus) the baby-plant level points, the
 * adult-plant level points, and the bonus points, plus a family total; and the
 * cross-family totals (all baby / all adult / all bonus). The three sources must
 * always sum to the player's actual score.
 *
 * Scenario (player 1):
 *   - Gum Tree  (baby_tree, ppl 2) @ level 1        -> tree baby  = 1*2 = 2
 *   - Boba Tree (trv_tree,  ppl 3) @ level 3 (L3)   -> tree adult = 3*3 = 9
 *       Boba bonus: per_baby_tree*1 (Gum) + per_trv_tree*1 (Boba) = 2 + 2 = 4  -> tree bonus = 4
 *   - Violet    (baby_flower, ppl 2) @ level 2      -> flower baby = 2*2 = 4
 * Totals: baby 6, adult 9, bonus 4, score 19.
 *
 * Run: php tests/php/ScoreBreakdownStatsTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    echo ($cond ? "  ok  — $label\n" : ("  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n"));
    if (!$cond) $failures++;
}

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

$game = new Game();
$game->bga = new \Bga\GameFramework\BgaStub();
$pid = 1;
$game->players[$pid] = ['name' => 'Alice'];

[$boba] = $game->plantCards->seed('Boba Tree', 0, 'garden_level3', $pid, 1);   // level forced to 3
[$p1] = $game->planterCards->seed('planter', 0, 'garden', $pid, 1);
$game->plantCards->seed('Gum Tree', 1, 'planter', $p1, 1);                     // level 1
[$p2] = $game->planterCards->seed('planter', 0, 'garden', $pid, 1);
$game->plantCards->seed('Violet', 2, 'planter', $p2, 1);                       // level 2

$scores = $game->calculateAllScores();
$st = $game->playerStats->values;
$g = fn(string $name) => $st[$name][$pid] ?? null;

echo "--- per-family breakdown ---\n";
check('tree baby = 2',  $g('tree_baby_score') === 2,  'got ' . var_export($g('tree_baby_score'), true));
check('tree adult = 9', $g('tree_adult_score') === 9, 'got ' . var_export($g('tree_adult_score'), true));
check('tree bonus = 4', $g('tree_bonus_score') === 4, 'got ' . var_export($g('tree_bonus_score'), true));
check('tree total = 15', $g('tree_total_score') === 15, 'got ' . var_export($g('tree_total_score'), true));

check('flower baby = 4',  $g('flower_baby_score') === 4,  'got ' . var_export($g('flower_baby_score'), true));
check('flower adult = 0', $g('flower_adult_score') === 0, 'got ' . var_export($g('flower_adult_score'), true));
check('flower bonus = 0', $g('flower_bonus_score') === 0, 'got ' . var_export($g('flower_bonus_score'), true));
check('flower total = 4', $g('flower_total_score') === 4, 'got ' . var_export($g('flower_total_score'), true));

check('cactus total = 0', $g('cactus_total_score') === 0, 'got ' . var_export($g('cactus_total_score'), true));

echo "--- cross-family totals ---\n";
check('total baby = 6',  $g('total_baby_score') === 6,  'got ' . var_export($g('total_baby_score'), true));
check('total adult = 9', $g('total_adult_score') === 9, 'got ' . var_export($g('total_adult_score'), true));
check('total bonus = 4', $g('total_bonus_score') === 4, 'got ' . var_export($g('total_bonus_score'), true));

echo "--- invariant: baby + adult + bonus == score ---\n";
$sum = $g('total_baby_score') + $g('total_adult_score') + $g('total_bonus_score');
check('breakdown sums to the player score (19)', $sum === (int)$scores[$pid] && $sum === 19,
    "sum $sum vs score " . ($scores[$pid] ?? 'null'));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
