<?php
declare(strict_types=1);

/**
 * Coverage for the https://trello.com/c/61uLM9hR follow-up sweep: extending
 * the "sync via getArgs() on state entry, don't rely on notification
 * timing" pattern (already applied to WeatherPhaseBonus's PUBLIC
 * weather_public_bonus data) to two states whose UI depends on PRIVATE
 * per-player data instead — WeatherPhaseChoose's held character weather
 * cards and PlantingPhase's plant hand.
 *
 * Private data can't just be returned at the top level of getArgs() (that
 * would broadcast every player's hand to every other player) — it must go
 * through BGA's `_private` mechanism, keyed by the requesting player's id,
 * with `_merge_private` flattening it into the client's `args` object.
 * This is the FIRST use of `_private` in this codebase; this test can't
 * verify BGA's real wire delivery (only a live table can), but it DOES
 * verify the one thing entirely within this game's own control: that the
 * PHP correctly scopes each player's data to THEIR OWN id and never
 * commingles it with another player's, for whichever player is currently
 * asking.
 *
 * Run: php tests/php/PrivateHandGetArgsTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/PlantingPhase.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/WeatherPhaseChoose.php';
// Note: WeatherPhaseReveal.php is intentionally NOT required — WeatherPhaseChoose
// only references WeatherPhaseReveal::class as a ::class literal.

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\States\PlantingPhase;
use Bga\Games\OrigamePlantopia\States\WeatherPhaseChoose;
use Bga\Games\OrigamePlantopia\PlantingPlayerSubstate;
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

// ── PlantingPhase::getArgs() — private hand, scoped per requesting player ──
echo "--- PlantingPhase::getArgs() returns _private hand data, correctly scoped ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_planting_status' => PlantingPlayerSubstate::Ready->value];
$game->players[2] = ['name' => 'Bob', 'player_planting_status' => PlantingPlayerSubstate::Ready->value];
[$aliceCardId] = $game->plantCards->seed('Cattus', 0, 'hand', 1, 1);
[$bobCardId] = $game->plantCards->seed('Cutetus', 0, 'hand', 2, 1);

$state = new PlantingPhase($game);
$state->bga = new BgaStub();

$game->currentPlayerId = 1;
$argsForAlice = $state->getArgs();
check('getArgs() still returns planting_statuses (existing behavior, unchanged)',
    array_key_exists('planting_statuses', $argsForAlice));
check('_private is keyed by the REQUESTING player (1), not some other player',
    array_key_exists('_private', $argsForAlice) && array_key_exists(1, $argsForAlice['_private']));
check('_merge_private flag is set (so the client sees args.hand directly, not args._private.hand)',
    ($argsForAlice['_merge_private'] ?? false) === true);
check("Alice's own card is in her _private[1] slice",
    array_key_exists($aliceCardId, $argsForAlice['_private'][1]['hand'] ?? []));
check("Bob's card is NOT anywhere in Alice's getArgs() result — this is the actual privacy check",
    !array_key_exists($bobCardId, $argsForAlice['_private'][1]['hand'] ?? [])
    && !array_key_exists(2, $argsForAlice['_private'] ?? [])
    && strpos(json_encode($argsForAlice), (string)$bobCardId) === false);

$game->currentPlayerId = 2;
$argsForBob = $state->getArgs();
check('_private is keyed by the REQUESTING player (2) on Bob\'s own request',
    array_key_exists('_private', $argsForBob) && array_key_exists(2, $argsForBob['_private']));
check("Bob's own card is in his _private[2] slice",
    array_key_exists($bobCardId, $argsForBob['_private'][2]['hand'] ?? []));
check("Alice's card is NOT anywhere in Bob's getArgs() result",
    !array_key_exists($aliceCardId, $argsForBob['_private'][2]['hand'] ?? [])
    && !array_key_exists(1, $argsForBob['_private'] ?? [])
    && strpos(json_encode($argsForBob), (string)$aliceCardId) === false);

// ── WeatherPhaseChoose::getArgs() — private weatherHand, same scoping shape ──
echo "\n--- WeatherPhaseChoose::getArgs() returns _private weatherHand data, correctly scoped ---\n";
$wGame = new Game();
$wGame->players[1] = ['name' => 'Alice'];
$wGame->players[2] = ['name' => 'Bob'];
[$aliceWeatherCardId] = $wGame->weatherCards->seed('carrot', 0, 'hand', 1, 1);
[$bobWeatherCardId] = $wGame->weatherCards->seed('potato', 1, 'hand', 2, 1);

$wState = new WeatherPhaseChoose($wGame);
$wState->bga = new BgaStub();

$wGame->currentPlayerId = 1;
$wArgsForAlice = $wState->getArgs();
check('_merge_private flag is set', ($wArgsForAlice['_merge_private'] ?? false) === true);
check("Alice's own weather card is in her _private[1] slice",
    array_key_exists($aliceWeatherCardId, $wArgsForAlice['_private'][1]['weatherHand'] ?? []));
check("Bob's weather card is NOT anywhere in Alice's getArgs() result",
    !array_key_exists(2, $wArgsForAlice['_private'] ?? [])
    && strpos(json_encode($wArgsForAlice), (string)$bobWeatherCardId) === false);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
