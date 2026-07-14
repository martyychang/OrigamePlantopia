<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/alsJctgg
 * "Warning: The player_score / player_score_aux fields can be manipulated"
 *
 * BGA's "Dry run build" static analyzer flags any direct DbQuery UPDATE
 * of the player_score/player_score_aux columns — they must go through
 * the framework's $this->playerScore / $this->playerScoreAux
 * PlayerCounter objects instead, which is the only write path BGA's own
 * anti-cheat/replay tooling can audit.
 *
 * Two things to verify: (1) the source no longer contains a raw SQL
 * write to either column (a static check — this is exactly what the
 * "Dry run build" analyzer itself looks for), and (2) the counters
 * actually work end-to-end: initDb() during setup, then set() during
 * calculateAllScores() lands the right values, functionally unchanged
 * from the old DbQuery-based behavior.
 *
 * Run: php tests/php/PlayerScoreCounterApiTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantingPlayerSubstate.php';

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

// ── Static check: no raw DbQuery write to player_score/player_score_aux ──
echo "--- source no longer writes player_score/player_score_aux via raw SQL ---\n";
$src = file_get_contents(__DIR__ . '/../../origameplantopia/modules/php/Game.php');
check(
    'no DbQuery(...) call references player_score in the same statement',
    !preg_match('/DbQuery\([^;]*player_score/s', $src),
    'a raw SQL write to player_score/player_score_aux was found'
);
check('playerScore->set( is used instead', str_contains($src, 'playerScore->set('));
check('playerScoreAux->set( is used instead', str_contains($src, 'playerScoreAux->set('));
check('both counters are init\'d in setupNewGame (before first use)', str_contains($src, 'playerScore->initDb(') && str_contains($src, 'playerScoreAux->initDb('));

// ── Functional check: the counters actually carry the right values ──
echo "\n--- PlayerCounter API carries the same values the old DbQuery path did ---\n";
Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

$game = new Game();
$game->bga = new BgaStub();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->playerScore->initDb([1], 0);
$game->playerScoreAux->initDb([1], 0);

// One Treevolved plant (Geometree — no bonus_scoring, so the score is
// just level * points_per_level, nothing extra to account for) on a
// planter + 2 cards in hand.
[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
[$geometreeId] = $game->plantCards->seed('Geometree', 2, 'planter', 0, 1);
$game->plantCards->cards[$geometreeId]['location_arg'] = $planterId;
$game->plantCards->seed('Cutetus', 0, 'hand', 1, 2);

$game->calculateAllScores();

$expectedScore = 2 * Game::$PLANT_CARD_TYPES['Geometree']['points_per_level'];
$expectedAux = 1 * 1000 + 2; // 1 Treevolved plant, 2 cards in hand

check('playerScore->get(1) matches the computed score', $game->playerScore->get(1) === $expectedScore, "got={$game->playerScore->get(1)} expected=$expectedScore");
check('playerScoreAux->get(1) matches the packed tiebreaker value', $game->playerScoreAux->get(1) === $expectedAux, "got={$game->playerScoreAux->get(1)} expected=$expectedAux");
check('both counter values are real ints, not floats', is_int($game->playerScore->get(1)) && is_int($game->playerScoreAux->get(1)));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
