<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/jrwRThpC
 * "Awarded points per level do not match depicted value"
 *
 * points_per_level is the single source for BOTH the in-card tooltip and the
 * end-game score calc (Game.php: score += level × points_per_level). An audit of
 * every card's art (rainbow-leaf count in the top-right corner) against the code
 * found the tree values had drifted. This test locks each of the 33 cards to the
 * points-per-level its card art depicts — confirmed with Marty 2026-09-28 (he
 * corrected Monte Carlo Tree back to 2; the art shows 2, not 3) — so a future
 * edit can't silently desync the scoring from the art again.
 *
 * If the art itself changes, update EXPECTED here in the same commit as the data.
 *
 * Run: php tests/php/PointsPerLevelMatchesArtTest.php
 */

require __DIR__ . '/harness.php';   // defines clienttranslate() used by PlantCards::getTypes()
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';

use Bga\Games\Plantopia\PlantCards;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    echo ($cond ? "  ok  — $label\n" : ("  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n"));
    if (!$cond) $failures++;
}

// Points-per-level as depicted on each card's art (source of truth).
$EXPECTED = [
    // Baby cactus
    'Cattus' => 1, 'Cutetus' => 1, 'Pointless Cactus' => 1, 'Sand Dollar Cactus' => 2,
    // Baby flower
    'Buttercup' => 1, 'Natural Flower' => 1, 'Twolips' => 1, 'Violet' => 2,
    // Baby tree
    'Gum Tree' => 2, 'Pepper Tree' => 2, 'Tree Tree' => 2, 'Treegonometree' => 2,
    // Adult cactus
    'Battus' => 2, 'Bufftus' => 3, 'Cactie' => 2, 'Captus' => 2,
    'Dogtus' => 2, 'Suckulent' => 2, 'Thornos' => 2,
    // Adult flower
    'Arrowhead' => 2, 'Call-A-Lily' => 2, 'Carnation' => 2, 'Firecracker Flower' => 3,
    'Lily-of-the-Rainbow' => 2, 'Money Plant' => 2, 'Potted Planted Potted Plants' => 2,
    // Adult tree
    'Boba Tree' => 3, 'Geometree' => 3, 'Impossible Tree' => 3, 'Monte Carlo Tree' => 2,
    'Square Root of Tree' => 2, 'Symmetree' => 3, 'Treenity' => 3,
];

$types = PlantCards::getTypes();

check('all 33 cards are covered by EXPECTED', count($EXPECTED) === 33, (string)count($EXPECTED));

foreach ($EXPECTED as $card => $want) {
    $have = $types[$card]['points_per_level'] ?? null;
    check("$card points_per_level = $want (matches art)", $have === $want, "code has " . var_export($have, true));
}

// Guard against a new card appearing without an art value here.
foreach ($types as $card => $info) {
    if (isset($info['points_per_level'])) {
        check("$card is listed in EXPECTED", array_key_exists($card, $EXPECTED), "new card not in the audit list");
    }
}

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
