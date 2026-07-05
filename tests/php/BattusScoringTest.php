<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/K1iHgIDS
 * "Rule clarification: Do 'all Weather Cards' include character weather
 * cards?" — Battus (and Money Plant / Monte Carlo Tree, same wording)
 * score "1 Point per 2 cards in hand at the end of the game (including
 * all Weather Cards)".
 *
 * Drives the REAL PlantCards.php card data against calculateAllScores()
 * (a faithful copy in harness.php — see the comment there on why it's a
 * copy rather than requiring the real Game.php). Reproduces Marty's
 * exact example: 0 plant cards in hand, 0 Bonus Weather cards, 3
 * character weather cards in hand → Battus should still score
 * floor(3/2) = 1 point.
 *
 * Run: php tests/php/BattusScoringTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;
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

// ── Scenario from Marty's clarification ─────────────────────────────
// Player 1 has a single planted Battus (Treevolved Cactus, level 0 —
// points_per_level doesn't matter for this test, only bonus_scoring
// does), ZERO plant cards in hand, ZERO Bonus Weather cards held, and
// 3 character weather cards (their claimed character's sun/rain/wind)
// sitting in weatherCards' 'hand' location.
$game = new Game();
$game->players[1] = ['name' => 'Alice'];
$bga = new BgaStub();
$game->bga = $bga;

[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
[$battusId] = $game->plantCards->seed('Battus', 0, 'planter', $planterId, 1);
// 0 plant cards in hand (none seeded), 0 bonus weather (none seeded).
// 3 character weather cards in the player's hand:
$game->weatherCards->seed('banana', 0, 'hand', 1, 1); // sun
$game->weatherCards->seed('banana', 1, 'hand', 1, 1); // rain
$game->weatherCards->seed('banana', 2, 'hand', 1, 1); // wind

$scores = $game->calculateAllScores();

echo "--- Marty's example: 0 plant cards, 0 bonus weather, 3 character weather ---\n";
check('Battus alone scores exactly 1 point (floor(3/2)*1)', ($scores[1] ?? null) == 1, 'got ' . json_encode($scores));

// ── Additional case: Bonus Weather must NOT count (it's public, not hand) ──
$game2 = new Game();
$game2->players[1] = ['name' => 'Bob'];
$game2->bga = new BgaStub();
[$planterId2] = $game2->planterCards->seed('planter', 0, 'garden', 1, 1);
[$battusId2] = $game2->plantCards->seed('Battus', 0, 'planter', $planterId2, 1);
// 0 plant cards in hand, 4 Bonus Weather cards HELD (public stash, not hand),
// 1 character weather card in hand.
$game2->weatherCards->seed('bonus', 0, 'weather_public_bonus', 1, 4);
$game2->weatherCards->seed('banana', 0, 'hand', 1, 1);

$scores2 = $game2->calculateAllScores();
echo "\n--- Bonus Weather (public stash) must not count toward the hand bonus ---\n";
check('4 held Bonus Weather + 1 character weather → still floor(1/2)=0 points (bonus weather excluded)',
    ($scores2[1] ?? null) == 0, 'got ' . json_encode($scores2));

// ── Sanity case: plant cards in hand still count as before (no regression) ──
$game3 = new Game();
$game3->players[1] = ['name' => 'Carol'];
$game3->bga = new BgaStub();
[$planterId3] = $game3->planterCards->seed('planter', 0, 'garden', 1, 1);
[$battusId3] = $game3->plantCards->seed('Battus', 0, 'planter', $planterId3, 1);
$game3->plantCards->seed('Buttercup', 0, 'hand', 1, 5); // 5 plant cards in hand
// no weather cards at all

$scores3 = $game3->calculateAllScores();
echo "\n--- Plant-card-only hand count still works (no regression) ---\n";
check('5 plant cards in hand alone → floor(5/2)=2 points', ($scores3[1] ?? null) == 2, 'got ' . json_encode($scores3));

// ── Combined case: plant cards + character weather cards both count ──
$game4 = new Game();
$game4->players[1] = ['name' => 'Dave'];
$game4->bga = new BgaStub();
[$planterId4] = $game4->planterCards->seed('planter', 0, 'garden', 1, 1);
[$battusId4] = $game4->plantCards->seed('Battus', 0, 'planter', $planterId4, 1);
$game4->plantCards->seed('Buttercup', 0, 'hand', 1, 3); // 3 plant cards
$game4->weatherCards->seed('banana', 0, 'hand', 1, 3);  // 3 character weather cards
// total 6 cards in hand → floor(6/2) = 3

$scores4 = $game4->calculateAllScores();
echo "\n--- Plant cards + character weather cards combine correctly ---\n";
check('3 plant + 3 character weather = 6 total → floor(6/2)=3 points', ($scores4[1] ?? null) == 3, 'got ' . json_encode($scores4));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
