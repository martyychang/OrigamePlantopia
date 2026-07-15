<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/K1iHgIDS
 * "Rule clarification: Do 'all Weather Cards' include character weather
 * cards?" — Battus (and Money Plant / Monte Carlo Tree, same wording)
 * score "1 Point per 2 cards in hand at the end of the game (including
 * all Weather Cards)".
 *
 * Marty's final ruling: "all Weather Cards" means ALL of them — both
 * held character weather cards (private, weatherCards' 'hand' location)
 * AND held Bonus Weather cards (public, weatherCards'
 * 'weather_public_bonus' location — see https://trello.com/c/B5g3UmED
 * for why Bonus Weather lives there instead of 'hand').
 *
 * Drives the REAL PlantCards.php card data against calculateAllScores()
 * (a faithful copy in harness.php — see the comment there on why it's a
 * copy rather than requiring the real Game.php).
 *
 * Run: php tests/php/BattusScoringTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
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

/**
 * Build a single-player game with one planted Battus and the given hand
 * composition, then return that player's final score (Battus is the
 * only scoring source in play, so the returned score IS the
 * per_two_cards_in_hand bonus for the given card counts).
 */
function scoreBattusScenario(int $plantCardsInHand, int $bonusWeatherHeld, int $characterWeatherInHand): int {
    static $nextPlayerId = 1;
    $playerId = $nextPlayerId++;

    $game = new Game();
    $game->players[$playerId] = ['name' => "P$playerId"];
    $game->bga = new \Bga\GameFramework\BgaStub();

    [$planterId] = $game->planterCards->seed('planter', 0, 'garden', $playerId, 1);
    $game->plantCards->seed('Battus', 0, 'planter', $planterId, 1);

    if ($plantCardsInHand > 0) {
        $game->plantCards->seed('Buttercup', 0, 'hand', $playerId, $plantCardsInHand);
    }
    if ($bonusWeatherHeld > 0) {
        $game->weatherCards->seed('bonus', 0, 'weather_public_bonus', $playerId, $bonusWeatherHeld);
    }
    if ($characterWeatherInHand > 0) {
        $game->weatherCards->seed('banana', 0, 'hand', $playerId, $characterWeatherInHand);
    }

    $scores = $game->calculateAllScores();
    return (int)round($scores[$playerId] ?? -1);
}

// ── Marty's original clarification example ──────────────────────────
check(
    '0 plant + 0 bonus weather + 3 character weather → floor(3/2)=1 point',
    scoreBattusScenario(0, 0, 3) === 1
);

// ── Marty's three follow-up examples, confirming Bonus Weather DOES count ──
check(
    '1 plant + 1 bonus weather + 3 character weather → floor(5/2)=2 points',
    scoreBattusScenario(1, 1, 3) === 2
);
check(
    '1 plant + 2 bonus weather + 3 character weather → floor(6/2)=3 points',
    scoreBattusScenario(1, 2, 3) === 3
);
check(
    '2 plant + 1 bonus weather + 3 character weather → floor(6/2)=3 points',
    scoreBattusScenario(2, 1, 3) === 3
);

// ── No-regression sanity checks ──────────────────────────────────────
check(
    '5 plant cards alone (no weather at all) → floor(5/2)=2 points',
    scoreBattusScenario(5, 0, 0) === 2
);
check(
    '0 of everything → 0 points',
    scoreBattusScenario(0, 0, 0) === 0
);
check(
    '4 bonus weather alone (no plant, no character weather) → floor(4/2)=2 points',
    scoreBattusScenario(0, 4, 0) === 2
);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
