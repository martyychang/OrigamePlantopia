<?php
declare(strict_types=1);

/**
 * Systematic card-by-card audit (Marty's request): functional coverage
 * for 'per_level3' bonus_scoring (Suckulent, Lily-of-the-Rainbow, Square
 * Root of Tree — all "2 points for every level 3 plant, itself
 * included"), which had zero test coverage before this audit even
 * though the mechanic is shared across 3 cards.
 *
 * Run: php tests/php/PerLevel3ScoringTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;

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
$game->bga = new \Bga\GameFramework\BgaStub();
$playerId = 1;
$game->players[$playerId] = ['name' => 'Alice'];

// Suckulent itself at level 3 (garden_level3 forces level=3 regardless of type_arg).
[$suckulentId] = $game->plantCards->seed('Suckulent', 0, 'garden_level3', $playerId, 1);
// A second, unrelated level-3 plant (Symmetree) — should ALSO count toward Suckulent's bonus ("itself included" implies others count too).
[$symId] = $game->plantCards->seed('Symmetree', 0, 'garden_level3', $playerId, 1);
// A non-level-3 plant (on a planter, level 1) — must NOT count.
[$planterId] = $game->planterCards->seed('planter', 0, 'garden', $playerId, 1);
$game->plantCards->seed('Buttercup', 1, 'planter', $planterId, 1);

$scores = $game->calculateAllScores();

// Points contributed: Suckulent (level3, points_per_level=2) = 3*2=6; Symmetree (level3, treat_as trv_tree=>2, points_per_level=2) = 3*2=6;
// Buttercup (level 1, points_per_level=1) = 1*1=1.
// per_level3 bonus: 2 level-3 plants (Suckulent + Symmetree) * 2 pts (Suckulent's bonus_scoring) = 4.
// Total = 6 + 6 + 1 + 4 = 17.
check('per_level3 counts every level-3 plant (2 of them), scored at 2 pts each = 4, on top of level-based points', (int)round($scores[$playerId]) === 17, 'got ' . ($scores[$playerId] ?? 'null'));

// Isolate: a player with NO level-3 plants gets 0 from the per_level3 clause.
$game2 = new Game();
$game2->bga = new \Bga\GameFramework\BgaStub();
$game2->players[$playerId] = ['name' => 'Bob'];
[$planterId2] = $game2->planterCards->seed('planter', 0, 'garden', $playerId, 1);
$game2->plantCards->seed('Suckulent', 1, 'planter', $planterId2, 1); // Suckulent itself at level 1, not 3
$scores2 = $game2->calculateAllScores();
// Just points_per_level: level 1 * 2 = 2, no level-3 plants at all -> +0 bonus.
check('no level-3 plants at all -> per_level3 bonus contributes 0', (int)round($scores2[$playerId]) === 2, 'got ' . ($scores2[$playerId] ?? 'null'));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
