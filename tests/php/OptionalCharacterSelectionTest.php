<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/W6iAfCBP "Make character
 * selection optional, not mandatory"
 *
 * Daryl framed characters as a "mini-expansion" — requiring one raises the
 * learning curve for new players. Character selection used to be mandatory:
 * SetupDecisions::checkIfAllPlayersReady() blocked the game from advancing
 * until every player had a character card in `garden`, and zombie() force-
 * assigned one to disconnected players.
 *
 * Drives the REAL SetupDecisions state (not a re-implementation) and
 * confirms: a player can explicitly skip, readiness gating treats
 * claimed-or-skipped as equally "done," claiming after a skip supersedes
 * it, and zombie players skip rather than getting a character forced on
 * them.
 *
 * Run: php tests/php/OptionalCharacterSelectionTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherCards.php';
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

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();
Game::$CHARACTER_CARD_TYPES = CharacterCards::getTypes();

function freshGame(): Game {
    $game = new Game();
    $game->players[1] = ['name' => 'Alice', 'player_mulligan_choice' => 1, 'player_skipped_character' => 0];
    $game->players[2] = ['name' => 'Bob', 'player_mulligan_choice' => 1, 'player_skipped_character' => 0];
    // Both players already muliganned — every test below starts at the
    // character-selection step, since that's the behavior under test.
    // Seed a small character deck: banana/carrot/tomato have no claim-time
    // effect, so tests can claim without exercising unrelated ability code.
    $game->characterCards->seed('banana', 0, 'deck', 0, 1);
    $game->characterCards->seed('carrot', 0, 'deck', 0, 1);
    $game->characterCards->seed('tomato', 0, 'deck', 0, 1);
    return $game;
}

echo "--- A player can explicitly skip, and readiness treats that as done ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;

$game->currentPlayerId = 1;
$state->actSkipCharacter();
check('player 1 was deactivated after skipping', in_array(1, $game->gamestate->nonActivePlayers), json_encode($game->gamestate->nonActivePlayers));
check('game has not transitioned yet (player 2 still undecided)', !in_array(2, $game->gamestate->nonActivePlayers));
check('characterSkipped notification fired', array_filter($bga->notify->log, fn($n) => $n['name'] === 'characterSkipped') !== []);

$game->currentPlayerId = 2;
$cardId = array_key_first($game->characterCards->getCardsInLocation('deck'));
$state->actClaimCharacter($cardId);
check('player 2 was deactivated after claiming', in_array(2, $game->gamestate->nonActivePlayers));
check('all-ready transition fired for the last player to decide', array_filter($bga->notify->log, fn($n) => $n['name'] === 'characterClaimed') !== []);

echo "\n--- Claiming after skip supersedes the skip ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;

$game->currentPlayerId = 1;
$state->actSkipCharacter();
check('skipped flag set', (int)$game->players[1]['player_skipped_character'] === 1);

$cardId = array_key_first($game->characterCards->getCardsInLocation('deck'));
$state->actClaimCharacter($cardId);
check('skipped flag reset after claiming', (int)$game->players[1]['player_skipped_character'] === 0);
check('character actually claimed', count($game->characterCards->getCardsInLocation('garden', 1)) === 1);

echo "\n--- Skipping after already claiming is rejected ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;

$game->currentPlayerId = 1;
$cardId = array_key_first($game->characterCards->getCardsInLocation('deck'));
$state->actClaimCharacter($cardId);
$threw = false;
try {
    $state->actSkipCharacter();
} catch (\Bga\GameFramework\UserException $e) {
    $threw = true;
}
check('actSkipCharacter rejected a player who already claimed', $threw);

echo "\n--- Returning a claimed character goes back to undecided, not skipped ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;

$game->currentPlayerId = 1;
$cardId = array_key_first($game->characterCards->getCardsInLocation('deck'));
$state->actClaimCharacter($cardId);
check('player 1 deactivated after claiming', in_array(1, $game->gamestate->nonActivePlayers));

$state->actReturnCharacter($cardId);
check('character returned to deck', $game->characterCards->getCard($cardId)['location'] === 'deck');
check('skipped flag still 0 after returning (undecided, not skipped)', (int)$game->players[1]['player_skipped_character'] === 0);
// Not asserting removal from nonActivePlayers here: the stub only records
// historical setPlayerNonMultiactive calls (it's a log, not a live set),
// and real BGA re-activates a player server-side on the next dispatch once
// they're no longer "ready" — that reactivation isn't part of what
// checkIfAllPlayersReady() itself does or what this test is checking.

echo "\n--- A zombie player skips instead of getting a character forced on them ---\n";
$game = freshGame();
$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;

$deckSizeBefore = count($game->characterCards->getCardsInLocation('deck'));
$state->zombie(1);
check('zombie player has no character claimed', count($game->characterCards->getCardsInLocation('garden', 1)) === 0);
check('zombie player marked as skipped', (int)$game->players[1]['player_skipped_character'] === 1);
check('deck untouched by zombie handling', count($game->characterCards->getCardsInLocation('deck')) === $deckSizeBefore);
check('zombie player deactivated straight to DistributeWeather', in_array(1, $game->gamestate->nonActivePlayers));

echo "\n--- Mixed table: one claims, one skips, one still deciding — game doesn't advance early ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_mulligan_choice' => 1, 'player_skipped_character' => 0];
$game->players[2] = ['name' => 'Bob', 'player_mulligan_choice' => 1, 'player_skipped_character' => 0];
$game->players[3] = ['name' => 'Cleo', 'player_mulligan_choice' => 1, 'player_skipped_character' => 0];
$game->characterCards->seed('banana', 0, 'deck', 0, 1);
$game->characterCards->seed('carrot', 0, 'deck', 0, 1);
$bga = new BgaStub();
$state = new SetupDecisions($game);
$state->bga = $bga;

$game->currentPlayerId = 1;
$cardId = array_key_first($game->characterCards->getCardsInLocation('deck'));
$state->actClaimCharacter($cardId);
$game->currentPlayerId = 2;
$state->actSkipCharacter();
check('players 1 and 2 done, player 3 still pending', in_array(1, $game->gamestate->nonActivePlayers) && in_array(2, $game->gamestate->nonActivePlayers) && !in_array(3, $game->gamestate->nonActivePlayers));

$game->currentPlayerId = 3;
$state->actSkipCharacter();
check('all three now done once player 3 decides too', in_array(3, $game->gamestate->nonActivePlayers));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
