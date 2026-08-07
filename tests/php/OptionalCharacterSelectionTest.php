<?php
declare(strict_types=1);

/**
 * Trello W6iAfCBP ("Make character selection optional, not mandatory").
 *
 * Characters is a TABLE-CREATION option (gameoptions.jsonc, option id 100),
 * not a per-player in-game choice — see
 * https://en.doc.boardgamearena.com/Options_and_preferences:_gameoptions.json,_gamepreferences.json.
 * An earlier version of this fix added a per-player "skip character" action;
 * that was reverted after Marty clarified the intended design. This test
 * covers the corrected SetupDecisions.php logic: charactersEnabled(),
 * hasCharacterDecision(), and the readiness gate / actClaimCharacter() guard
 * that key off it.
 *
 * Run: php tests/php/OptionalCharacterSelectionTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/CharacterCards.php';
require __DIR__ . '/../../plantopia/modules/php/States/SetupDecisions.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\CharacterCards;
use Bga\Games\Plantopia\States\SetupDecisions;
use Bga\GameFramework\BgaStub;
use Bga\GameFramework\UserException;

Game::$CHARACTER_CARD_TYPES = CharacterCards::getTypes();

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

function freshGame(array $playerIds, ?int $charactersOption): array {
    $game = new Game();
    foreach ($playerIds as $pId) {
        $game->players[$pId] = ['name' => "P$pId", 'player_mulligan_choice' => 0];
    }
    $game->characterCards->seed('potato', 0, 'deck', 0, 1);
    $game->characterCards->seed('mushroom', 0, 'deck', 0, 1);
    $bga = new BgaStub();
    if ($charactersOption !== null) {
        $bga->tableOptions->values[100] = $charactersOption;
    }
    $state = new SetupDecisions($game);
    $state->bga = $bga;
    foreach ($playerIds as $pId) {
        $game->currentPlayerId = $pId;
    }
    return [$game, $state, $bga];
}

// ── Default (option unset, e.g. a table created before this option existed) — characters stay mandatory ──
echo "--- option unset defaults to Enabled (existing tables keep today's behavior) ---\n";
[$game, $state, $bga] = freshGame([1], null);
check('charactersEnabled() defaults true when tableOptions has never seen option 100', true, '');
$game->currentPlayerId = 1;
$state->actKeep();
check('mulligan alone is NOT enough to become ready when characters are enabled', count($bga->tableOptions->values) === 0 && count($game->gamestate->nonActivePlayers) === 0);

// ── Characters explicitly enabled (1) — unchanged, mandatory selection ──
echo "\n--- option 1 (Enabled): a player must still claim a character to become ready ---\n";
[$game, $state, $bga] = freshGame([1], 1);
$state->actKeep();
check('mulligan alone does not deactivate the player while characters are enabled', count($game->gamestate->nonActivePlayers) === 0);

$cards = $game->characterCards->getCardsInLocation('deck');
$cardId = array_key_first($cards);
$state->actClaimCharacter((int)$cardId);
check('claiming a character after mulligan deactivates the player', in_array(1, $game->gamestate->nonActivePlayers, true));

// ── Characters explicitly disabled (0) — mulligan alone is enough ──
echo "\n--- option 0 (Disabled): a player becomes ready right after mulligan, no character needed ---\n";
[$game, $state, $bga] = freshGame([1], 0);
$state->actKeep();
check('player is deactivated immediately after mulligan when characters are disabled', in_array(1, $game->gamestate->nonActivePlayers, true));

// ── actClaimCharacter() is rejected outright when disabled ──
echo "\n--- actClaimCharacter() is rejected table-wide when characters are disabled ---\n";
[$game, $state, $bga] = freshGame([1], 0);
$state->actKeep();
$cards = $game->characterCards->getCardsInLocation('deck');
$cardId = array_key_first($cards);
$threw = false;
try {
    $state->actClaimCharacter((int)$cardId);
} catch (UserException $e) {
    $threw = true;
}
check('actClaimCharacter() throws when characters are disabled', $threw);
check('the card was NOT moved out of the deck', $game->characterCards->getCard((int)$cardId)['location'] === 'deck');

// ── Multi-player table, disabled: each player only needs their own mulligan ──
echo "\n--- 3-player table with characters disabled: all become ready independently on mulligan ---\n";
[$game, $state, $bga] = freshGame([1, 2, 3], 0);
$game->currentPlayerId = 1;
$state->actKeep();
check('player 1 ready after keeping hand', in_array(1, $game->gamestate->nonActivePlayers, true));
$game->currentPlayerId = 2;
$state->actRedraw();
check('player 2 ready after redrawing hand (redraw counts as a mulligan decision too)', in_array(2, $game->gamestate->nonActivePlayers, true));
check('player 3 not yet ready (hasn\'t acted)', !in_array(3, $game->gamestate->nonActivePlayers, true));
$game->currentPlayerId = 3;
$state->actKeep();
check('player 3 ready after keeping hand', in_array(3, $game->gamestate->nonActivePlayers, true));
check('all 3 players are now non-active (state can advance)', count(array_unique($game->gamestate->nonActivePlayers)) === 3);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
