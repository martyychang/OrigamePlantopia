<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/DTEJePl6 "Implement tiebreaker
 * rules". Per the rulebook:
 *
 *   "In case of a tie the player with the most Adult Plants in their
 *   Garden wins. If players are still tied, the player with the most
 *   cards left in their hand wins. If players are still tied, all tied
 *   players are Champions!"
 *
 * BGA only exposes one player_score_aux column for automatic ranking
 * tie-breaks (higher aux wins a tie on equal player_score), so both
 * levels are packed into it: Adult Plants in the thousands place, cards
 * in hand in the units place (see Game::calculateAllScores). This test
 * verifies the packed value orders players the same way the rulebook
 * does, using the REAL PlantCards.php against the verbatim
 * calculateAllScores copy in harness.php.
 *
 * Run: php tests/php/TiebreakerTest.php
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

/**
 * Seed one player with the given number of Adult Plants (Battus at
 * level 3, so it doesn't also trigger per_two_cards_in_hand scoring
 * noise) and a given number of loose plant cards in hand, then return
 * their player_score_aux after calculateAllScores().
 */
function scoreAuxFor(Game $game, int $playerId, int $adultPlants, int $cardsInHand): void {
    $game->players[$playerId] = ['name' => "P$playerId"];
    for ($i = 0; $i < $adultPlants; $i++) {
        $game->plantCards->seed('Battus', 3, 'garden_level3', $playerId, 1);
    }
    if ($cardsInHand > 0) {
        $game->plantCards->seed('Buttercup', 0, 'hand', $playerId, $cardsInHand);
    }
}

$game = new Game();
$game->bga = new BgaStub();

// Player 1: 2 Adult Plants, 3 cards in hand.
scoreAuxFor($game, 1, 2, 3);
// Player 2: 2 Adult Plants (tied with P1), 5 cards in hand — should
// outrank P1 on the hand-count tiebreak.
scoreAuxFor($game, 2, 2, 5);
// Player 3: 3 Adult Plants (beats both), 0 cards in hand — Adult Plants
// takes priority over hand count, so P3 should outrank both.
scoreAuxFor($game, 3, 3, 0);

$game->calculateAllScores();

$aux1 = (int)$game->players[1]['player_score_aux'];
$aux2 = (int)$game->players[2]['player_score_aux'];
$aux3 = (int)$game->players[3]['player_score_aux'];

check('P1 (2 adult, 3 hand) packs to 2003', $aux1 === 2003, "got $aux1");
check('P2 (2 adult, 5 hand) packs to 2005', $aux2 === 2005, "got $aux2");
check('P3 (3 adult, 0 hand) packs to 3000', $aux3 === 3000, "got $aux3");

check('Same Adult Plants: more cards in hand outranks (P2 > P1)', $aux2 > $aux1, "aux2=$aux2 aux1=$aux1");
check('More Adult Plants outranks regardless of hand count (P3 > P2 and P3 > P1)', $aux3 > $aux2 && $aux3 > $aux1, "aux3=$aux3 aux2=$aux2 aux1=$aux1");

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
