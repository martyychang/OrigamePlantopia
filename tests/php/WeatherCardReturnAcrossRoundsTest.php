<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/Lml0M7zY ("Weather cards not
 * returned to player's hand in no-character game for next Weather Phase").
 *
 * Root cause: the 95PCkqui fix (DistributeWeatherNoCharactersTest.php)
 * dealt each player a random weather type on a no-character table, but
 * never persisted that assignment anywhere durable. WeatherPhaseGrow's
 * end-of-round "return played weather card to hand" step re-derives the
 * player's type from characterCards' 'garden' location — which is, BY
 * DESIGN, always empty on a no-character table. So round 1 worked (the
 * type was still implicitly known from the just-completed distribution),
 * but every round after that silently no-op'd: the played card just sat
 * in weather_public and got discarded with the rest of the pool, and the
 * player permanently lost that weather type.
 *
 * Fix: a new player_random_weather_type DB column persists the
 * no-character assignment, and Game::getPlayerWeatherType() is the single
 * place both DistributeWeather (write) and WeatherPhaseGrow (read) go
 * through — mirroring the character-enabled path's own read of
 * characterCards/garden. Marty's requirement is that the return-to-hand
 * behavior be IDENTICAL between character-enabled and character-disabled
 * tables, so this test drives both across multiple rounds and asserts the
 * same outcome each round.
 *
 * Run: php tests/php/WeatherCardReturnAcrossRoundsTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../plantopia/modules/php/CharacterCards.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/DistributeWeather.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseGrow.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\WeatherCards;
use Bga\Games\Plantopia\CharacterCards;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\States\DistributeWeather;
use Bga\Games\Plantopia\States\WeatherPhaseGrow;
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

Game::$CHARACTER_CARD_TYPES = CharacterCards::getTypes();
Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

/**
 * Simulates one player choosing to play their weather card (of $type) this
 * round: moves it from 'hand' to 'weather_public', exactly what
 * WeatherPhaseChoose -> WeatherPhaseReveal do in the real state flow.
 */
function playWeatherCard(Game $game, int $playerId, string $type): void {
    $hand = $game->weatherCards->getCardsInLocation('hand', $playerId);
    foreach ($hand as $id => $c) {
        if ($c['type'] === $type) {
            $game->weatherCards->moveCard($id, 'weather_public', 0);
            return;
        }
    }
    throw new \RuntimeException("player $playerId has no $type card in hand to play");
}

function runScenario(int $charactersOption, string $label): void {
    echo "\n--- $label ---\n";

    $game = new Game();
    $game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
    $game->players[2] = ['name' => 'Bob', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
    $game->weatherCards->createCards(WeatherCards::getDeckCards(), 'deck');

    $bga = new BgaStub();
    $bga->tableOptions->values[100] = $charactersOption;
    $game->bga = $bga;

    if ($charactersOption === 1) {
        // Character-enabled: each player has already claimed a distinct
        // character (normally done in SetupDecisions), which is the
        // durable record DistributeWeather and WeatherPhaseGrow both key
        // off in this mode.
        $game->characterCards->seed('potato', 0, 'garden', 1, 1);
        $game->characterCards->seed('tomato', 0, 'garden', 2, 1);
    }

    $distribute = new DistributeWeather($game);
    $distribute->bga = $bga;
    $distribute->onEnteringState(0);

    $aliceType = $game->getPlayerWeatherType(1);
    $bobType = $game->getPlayerWeatherType(2);
    check('Alice was assigned a real weather type', $aliceType !== null, (string)$aliceType);
    check('Bob was assigned a real weather type', $bobType !== null, (string)$bobType);
    check("Alice and Bob got DISTINCT types (Alice=$aliceType, Bob=$bobType)", $aliceType !== null && $bobType !== null && $aliceType !== $bobType);

    $grow = new WeatherPhaseGrow($game);
    $grow->bga = $bga;

    // Drive 3 consecutive Weather Phase rounds. The bug only manifested
    // from round 2 onward, so 3 rounds gives it two chances to reappear.
    for ($round = 1; $round <= 3; $round++) {
        check("round $round: Alice's $aliceType card is in hand before playing", count(array_filter($game->weatherCards->getCardsInLocation('hand', 1), fn($c) => $c['type'] === $aliceType)) === 3, 'expected all 3 back from the previous round');
        check("round $round: Bob's $bobType card is in hand before playing", count(array_filter($game->weatherCards->getCardsInLocation('hand', 2), fn($c) => $c['type'] === $bobType)) === 3, 'expected all 3 back from the previous round');

        playWeatherCard($game, 1, $aliceType);
        playWeatherCard($game, 2, $bobType);

        // Both players' cards now sit together in the SAME shared
        // 'weather_public' pool — this is exactly the mixed-type scenario
        // the harness's getCardsOfTypeInLocation() previously mishandled
        // (see the fix in this same commit), and exactly what would let a
        // now-broken WeatherPhaseGrow accidentally hand Bob's card to
        // Alice instead of losing it — a false pass this test needs to
        // rule out too.
        $grow->onEnteringState(0);

        $aliceHandOfType = array_filter($game->weatherCards->getCardsInLocation('hand', 1), fn($c) => $c['type'] === $aliceType);
        $bobHandOfType = array_filter($game->weatherCards->getCardsInLocation('hand', 2), fn($c) => $c['type'] === $bobType);
        check("round $round: Alice's played $aliceType card returned to HER hand", count($aliceHandOfType) === 3, 'got=' . count($aliceHandOfType));
        check("round $round: Bob's played $bobType card returned to HIS hand", count($bobHandOfType) === 3, 'got=' . count($bobHandOfType));
        check("round $round: Alice did not receive any of Bob's $bobType cards", count(array_filter($game->weatherCards->getCardsInLocation('hand', 1), fn($c) => $c['type'] === $bobType)) === 0);
    }
}

// Marty's requirement (https://trello.com/c/Lml0M7zY): the return-to-hand
// behavior must be IDENTICAL whether Characters is enabled or disabled.
runScenario(1, 'Characters ENABLED: weather cards return to hand every round');
runScenario(0, 'Characters DISABLED: weather cards return to hand every round (the regression)');

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
