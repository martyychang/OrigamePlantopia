<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/vjsQX06a
 * "The player panel hand counts are completely wrong"
 *
 * Root cause: the BGA Deck component's countCardsByLocationArgs() returns
 * counts as numeric STRINGS (raw SQL COUNT results), not ints. Several
 * server call sites broadcast that array straight to the client as
 * "handCounts" without casting. The client's notif_updateScores /
 * notif_potatoExtraCards handlers merge it into gamedatas.handCounts via
 * Object.assign, and OTHER handlers update that same value with `+=`.
 * JS `+` is ambiguous — number+number adds, but string+number concatenates
 * — so the very first string value poisoned every later update into
 * concatenation instead of addition, producing exactly the garbled,
 * per-viewer-inconsistent counts Marty reported.
 *
 * FakeDeck::countCardsByLocationArgs() in harness.php deliberately mirrors
 * this string-returning behavior, so this test fails without the
 * array_map('intval', ...) casts and passes with them.
 *
 * Run: php tests/php/HandCountTypesTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/CharacterCards.php';
require __DIR__ . '/../../plantopia/modules/php/States/SetupDecisions.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\CharacterCards;
use Bga\Games\Plantopia\States\SetupDecisions;
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

function allInts(array $counts): bool {
    foreach ($counts as $v) {
        if (!is_int($v)) return false;
    }
    return true;
}

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();
Game::$CHARACTER_CARD_TYPES = CharacterCards::getTypes();

// ── Arrange: two players, one claims Potato (draws 4 extra cards) ──────────
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_mulligan_choice' => 1];
$game->players[2] = ['name' => 'Bob', 'player_mulligan_choice' => 1];
$game->currentPlayerId = 1;

$game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
$game->plantCards->seed('Buttercup', 0, 'hand', 1, 6);
$game->plantCards->seed('Buttercup', 0, 'hand', 2, 11);

[$potatoId] = $game->characterCards->seed('potato', 0, 'deck', 0, 1);

$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;

// ── Act: Alice claims Potato → applyClaimAbility draws 4, broadcasts handCounts ──
$state->actClaimCharacter($potatoId);

$potatoNotif = array_values(array_filter($bga->notify->log, fn($e) => $e['name'] === 'potatoExtraCards'))[0] ?? null;
check('server sent a "potatoExtraCards" notification', $potatoNotif !== null);
check(
    'potatoExtraCards handCounts are all real ints, not numeric strings',
    $potatoNotif && allInts($potatoNotif['args']['handCounts']),
    $potatoNotif ? json_encode(array_map('gettype', $potatoNotif['args']['handCounts'])) : 'n/a'
);
check('Alice\'s hand count is 10 (6 + 4 drawn)', $potatoNotif && ($potatoNotif['args']['handCounts'][1] ?? null) === 10);

// ── Same check for calculateAllScores' updateScores broadcast ──────────────
$bga->notify->log = [];
$game->bga = $bga;
$game->calculateAllScores();

$scoresNotif = array_values(array_filter($bga->notify->log, fn($e) => $e['name'] === 'updateScores'))[0] ?? null;
check('server sent an "updateScores" notification', $scoresNotif !== null);
check(
    'updateScores handCounts are all real ints, not numeric strings',
    $scoresNotif && allInts($scoresNotif['args']['handCounts']),
    $scoresNotif ? json_encode(array_map('gettype', $scoresNotif['args']['handCounts'])) : 'n/a'
);

// Note: PlantingPhase.php's playerUsedBananaAbility handCounts broadcast got
// the identical one-line array_map('intval', ...) fix but isn't separately
// covered here — same fix, same shape, and exercising it needs a full
// Banana-offer setup that wouldn't add meaningfully different coverage.

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
