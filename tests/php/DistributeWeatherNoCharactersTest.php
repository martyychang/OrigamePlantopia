<?php
declare(strict_types=1);

/**
 * Trello 95PCkqui ("No weather buttons available to choose in no-character
 * game"). Root cause: DistributeWeather::onEnteringState() only ever looked
 * at characterCards' 'garden' location to find each player's weather-card
 * type — with Characters disabled (Trello W6iAfCBP), that location is never
 * populated for anyone, so every player got an empty weatherCards hand and
 * WeatherPhaseChoose rendered zero buttons.
 *
 * Fix: when characters are disabled, deal each player a random character's
 * weather cards directly, without ever touching characterCards/garden —
 * so PlantingPhase's getPlayerCharacter() (Carrot/Tomato effects, Banana
 * eligibility) and the player panel's character icon stay correctly inert.
 *
 * Run: php tests/php/DistributeWeatherNoCharactersTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../plantopia/modules/php/CharacterCards.php';
require __DIR__ . '/../../plantopia/modules/php/States/DistributeWeather.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\WeatherCards;
use Bga\Games\Plantopia\CharacterCards;
use Bga\Games\Plantopia\States\DistributeWeather;
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
$CHARACTER_TYPES = array_keys(CharacterCards::getTypes());

function freshGame(array $playerIds, ?int $charactersOption): array {
    $game = new Game();
    foreach ($playerIds as $pId) {
        $game->players[$pId] = ['name' => "P$pId"];
    }
    $game->weatherCards->createCards(WeatherCards::getDeckCards(), 'deck');
    $bga = new BgaStub();
    if ($charactersOption !== null) {
        $bga->tableOptions->values[100] = $charactersOption;
    }
    $game->bga = $bga;
    $state = new DistributeWeather($game);
    $state->bga = $bga;
    return [$game, $state, $bga];
}

// ── Enabled + claimed character: unchanged existing behavior ──
echo "--- Characters enabled: a player who claimed a character gets that character's 3 weather cards ---\n";
[$game, $state, $bga] = freshGame([1], 1);
$game->characterCards->seed('potato', 0, 'garden', 1, 1);
$state->onEnteringState(1);
$hand = $game->weatherCards->getCardsInLocation('hand', 1);
check('player 1 received exactly 3 weather cards', count($hand) === 3, (string)count($hand));
check('all 3 are potato-type', count(array_filter($hand, fn($c) => $c['type'] === 'potato')) === 3);

// ── Enabled + no claim: unchanged existing behavior (regression) ──
echo "\n--- Characters enabled: a player who never claimed a character still gets nothing ---\n";
[$game, $state, $bga] = freshGame([1], 1);
$state->onEnteringState(1);
check('player 1 hand stays empty', count($game->weatherCards->getCardsInLocation('hand', 1)) === 0);

// ── Disabled: the actual bug — every player must get SOME weather hand ──
echo "\n--- Characters disabled: every player gets a full 3-card weather hand despite never claiming ---\n";
[$game, $state, $bga] = freshGame([1, 2, 3], 0);
$state->onEnteringState(1);
$assignedTypes = [];
foreach ([1, 2, 3] as $pId) {
    $hand = $game->weatherCards->getCardsInLocation('hand', $pId);
    check("player $pId received exactly 3 weather cards", count($hand) === 3, (string)count($hand));
    $types = array_unique(array_column($hand, 'type'));
    check("player $pId's 3 cards are all the same (one character's) type", count($types) === 1, json_encode($types));
    global $CHARACTER_TYPES;
    check("player $pId's type is a real character type", in_array($types[0] ?? null, $CHARACTER_TYPES, true));
    $assignedTypes[$pId] = $types[0] ?? null;
}
// The bug this test guards against: independent per-player array_rand()
// could assign the SAME type to two players, and the second one would
// find that type's cards already drained from the deck by the first,
// leaving them with an empty hand (reproduced during development —
// see the shuffle-once-and-consume-in-order fix in DistributeWeather.php).
check('all 3 players got DISTINCT character types (no collision)', count(array_unique($assignedTypes)) === 3, json_encode($assignedTypes));

// ── Disabled: no characterCards record was ever created for anyone ──
echo "\n--- Characters disabled: no character is ever placed in anyone's garden (no ability/icon leakage) ---\n";
check('characterCards garden is empty for player 1', count($game->characterCards->getCardsInLocation('garden', 1)) === 0);
check('characterCards garden is empty for player 2', count($game->characterCards->getCardsInLocation('garden', 2)) === 0);
check('characterCards garden is empty for player 3', count($game->characterCards->getCardsInLocation('garden', 3)) === 0);
check('characterCards deck is empty too (never created)', count($game->characterCards->getCardsInLocation('deck')) === 0);

// ── Disabled: option unset (pre-existing table) defaults to Enabled behavior ──
echo "\n--- Option unset defaults to Enabled: a player with no claim still gets nothing ---\n";
[$game, $state, $bga] = freshGame([1], null);
$state->onEnteringState(1);
check('player 1 hand stays empty when option is unset and no character was claimed', count($game->weatherCards->getCardsInLocation('hand', 1)) === 0);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
