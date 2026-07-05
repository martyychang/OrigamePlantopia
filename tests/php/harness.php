<?php
declare(strict_types=1);

/**
 * Minimal BGA-framework stub so we can `require` the REAL
 * origameplantopia/modules/php/States/PlantingPhase.php (and its sibling
 * PlantCards.php / CharacterCards.php / WeatherCards.php) unmodified and
 * exercise it with plain PHP — no BGA Studio runtime, no DB.
 *
 * This file defines fake classes under the exact namespaces PlantingPhase.php
 * imports (Bga\GameFramework\*, Bga\Games\OrigamePlantopia\Game). Because
 * autoloading here is just `require`, whichever class definition loads FIRST
 * under a given fully-qualified name wins — we never load the real Game.php
 * (it depends on the actual BGA Table/DB machinery), only our FakeGame here.
 *
 * Scope: enough surface to run actPlant / queueEffects / processPendingEffects
 * / actResolveDraft end-to-end for a single-player scenario. Not a general
 * BGA test harness — extend the fakes below as new methods are needed.
 *
 * Note: this file mixes braced namespace blocks, so ALL top-level code
 * (including the global clienttranslate() stub) must also live in a braced
 * `namespace { ... }` block — PHP forbids mixing bracketed and unbracketed
 * namespace declarations in the same file.
 */

namespace {
    if (!function_exists('clienttranslate')) {
        function clienttranslate(string $s): string { return $s; }
    }
}

namespace Bga\GameFramework {
    enum StateType {
        case GAME;
        case MULTIPLE_ACTIVE_PLAYER;
        case ACTIVE_PLAYER;
    }

    class UserException extends \Exception {}

    class NotifyStub {
        public array $log = [];
        function all(string $name, string $msg, array $args = []) {
            $this->log[] = ['scope' => 'all', 'name' => $name, 'args' => $args];
        }
        function player(int $playerId, string $name, string $msg, array $args = []) {
            $this->log[] = ['scope' => 'player', 'player_id' => $playerId, 'name' => $name, 'args' => $args];
        }
    }

    class GamestateStub {
        public array $nonActivePlayers = [];
        function setAllPlayersMultiactive() {}
        function setPlayerNonMultiactive(int $playerId, $next) {
            $this->nonActivePlayers[] = $playerId;
        }
    }

    class BgaStub {
        public NotifyStub $notify;
        function __construct() { $this->notify = new NotifyStub(); }
    }
}

namespace Bga\GameFramework\States {
    class GameState {
        public $bga;
        function __construct($game, ...$args) {}
    }
    #[\Attribute]
    class PossibleAction {}
}

namespace Bga\Games\OrigamePlantopia {

    /**
     * In-memory stand-in for the BGA "Deck" component. Cards are rows with
     * id/type/type_arg/location/location_arg, same shape the real Deck
     * component returns from getCard()/getCardsInLocation().
     */
    class FakeDeck {
        public array $cards = []; // id => row
        private int $nextId;
        function __construct(int $startId) { $this->nextId = $startId; }

        function seed(string $type, int $typeArg, string $location, $locationArg, int $count): array {
            $ids = [];
            for ($i = 0; $i < $count; $i++) {
                $id = $this->nextId++;
                $this->cards[$id] = ['id' => $id, 'type' => $type, 'type_arg' => $typeArg, 'location' => $location, 'location_arg' => $locationArg];
                $ids[] = $id;
            }
            return $ids;
        }

        function getCard(int $id): array { return $this->cards[$id]; }

        function getCardsInLocation(string $location, $locationArg = null): array {
            $out = [];
            foreach ($this->cards as $id => $c) {
                if ($c['location'] !== $location) continue;
                if ($locationArg !== null && (string)$c['location_arg'] !== (string)$locationArg) continue;
                $out[$id] = $c;
            }
            return $out;
        }

        function getCardsOfTypeInLocation(string $location, $typeArg, $fromLocation): array {
            $out = [];
            foreach ($this->cards as $id => $c) {
                if ($c['location'] !== $fromLocation) continue;
                if ($typeArg !== null && (string)$c['type_arg'] !== (string)$typeArg) continue;
                $out[$id] = $c;
            }
            return $out;
        }

        function countCardInLocation(string $location, $locationArg = null): int {
            return count($this->getCardsInLocation($location, $locationArg));
        }

        function countCardsByLocationArgs(string $location): array {
            $counts = [];
            foreach ($this->cards as $c) {
                if ($c['location'] !== $location) continue;
                $counts[$c['location_arg']] = ($counts[$c['location_arg']] ?? 0) + 1;
            }
            return $counts;
        }

        function moveCard(int $id, string $location, $locationArg = 0): void {
            $this->cards[$id]['location'] = $location;
            $this->cards[$id]['location_arg'] = $locationArg;
        }

        function moveCards(array $ids, string $location, $locationArg = 0): void {
            foreach ($ids as $id) $this->moveCard($id, $location, $locationArg);
        }

        function moveAllCardsInLocation(string $from, string $to): void {
            foreach ($this->cards as $id => $c) {
                if ($c['location'] === $from) $this->moveCard($id, $to);
            }
        }

        function pickCards(int $nbr, string $location, int $playerId): array {
            return $this->pickCardsForLocation($nbr, $location, 'hand', $playerId);
        }

        function pickCardsForLocation(int $nbr, string $from, string $to, $locationArg = 0): array {
            $avail = array_keys($this->getCardsInLocation($from));
            $take = array_slice($avail, 0, $nbr);
            $out = [];
            foreach ($take as $id) {
                $this->moveCard($id, $to, $locationArg);
                $out[$id] = $this->cards[$id];
            }
            return $out;
        }

        function shuffle(string $location): void { /* deterministic no-op for tests */ }

        function createCards(array $defs, string $location): void {
            foreach ($defs as $def) {
                $this->seed($def['type'], $def['type_arg'], $location, 0, $def['nbr']);
            }
        }
    }

    /**
     * Fake Game — same namespace+class name as the real Game so
     * `use Bga\Games\OrigamePlantopia\Game;` in PlantingPhase.php resolves
     * to THIS class. We never require the real Game.php.
     */
    class Game {
        public FakeDeck $plantCards;
        public FakeDeck $characterCards;
        public FakeDeck $planterCards;
        public FakeDeck $weatherCards;
        public array $players = []; // playerId => ['name' => ..., 'pending_effects' => '[]', 'planting_status' => 0, 'banana_used' => 0]
        public int $currentPlayerId;
        public static array $PLANT_CARD_TYPES = [];
        public static array $CHARACTER_CARD_TYPES = [];
        public $gamestate;
        public $bga;

        function __construct() {
            $this->plantCards = new FakeDeck(1000);
            $this->characterCards = new FakeDeck(5000);
            $this->planterCards = new FakeDeck(6000);
            $this->weatherCards = new FakeDeck(9000);
            $this->gamestate = new \Bga\GameFramework\GamestateStub();
        }

        /**
         * Verbatim copy of Game::calculateAllScores() as of the commit
         * that fixed https://trello.com/c/K1iHgIDS (character weather
         * cards counting toward per_two_cards_in_hand). Kept here rather
         * than requiring the real Game.php, which extends BGA's Table
         * class and pulls in DB/framework dependencies this harness
         * doesn't stub. If this method changes in the real Game.php,
         * re-sync this copy — a drifted copy would silently test stale
         * logic.
         */
        function calculateAllScores(): array {
            $players = $this->loadPlayersBasicInfos();
            $handCounts = $this->plantCards->countCardsByLocationArgs('hand');
            $weatherHandCounts = $this->weatherCards->countCardsByLocationArgs('hand');

            $planters = $this->planterCards->getCardsInLocation('garden');
            $planterToPlayer = [];
            foreach ($planters as $planter) {
                $planterToPlayer[$planter['id']] = (int)$planter['location_arg'];
            }

            $plantsOnPlanters = $this->plantCards->getCardsInLocation('planter');
            $plantsLevel3 = $this->plantCards->getCardsInLocation('garden_level3');

            $scores = [];

            foreach ($players as $playerId => $playerInfo) {
                $playerId = (int)$playerId;
                $score = 0;
                $cardsInHand = ($handCounts[$playerId] ?? 0) + ($weatherHandCounts[$playerId] ?? 0);

                $playerPlants = [];
                foreach ($plantsOnPlanters as $plant) {
                    if (isset($planterToPlayer[$plant['location_arg']]) && $planterToPlayer[$plant['location_arg']] === $playerId) {
                        $playerPlants[] = $plant;
                    }
                }
                foreach ($plantsLevel3 as $plant) {
                    if ((int)$plant['location_arg'] === $playerId) {
                        $playerPlants[] = $plant;
                    }
                }

                $counts = [
                    'level3' => 0,
                    'baby_tree' => 0,
                    'trv_tree' => 0,
                    'baby_cactus' => 0,
                    'trv_cactus' => 0,
                    'baby_flower' => 0,
                    'trv_flower' => 0,
                    'plant_types' => [],
                ];

                foreach ($playerPlants as $plant) {
                    $plantInfo = self::$PLANT_CARD_TYPES[$plant['type']];
                    $level = (int)$plant['type_arg'];
                    if ($plant['location'] === 'garden_level3') {
                        $level = 3;
                    }

                    $score += $level * $plantInfo['points_per_level'];
                    if ($level === 3) {
                        $counts['level3']++;
                    }

                    $counts['plant_types'][$plantInfo['plant_type']] = true;

                    $treatAs = $plantInfo['treat_as'] ?? [$plantInfo['plant_type'] => 1];
                    foreach ($treatAs as $type => $amount) {
                        if ($type === PlantCards::BABY_TREE) $counts['baby_tree'] += $amount;
                        if ($type === PlantCards::TRV_TREE) $counts['trv_tree'] += $amount;
                        if ($type === PlantCards::BABY_CACTUS) $counts['baby_cactus'] += $amount;
                        if ($type === PlantCards::TRV_CACTUS) $counts['trv_cactus'] += $amount;
                        if ($type === PlantCards::BABY_FLOWER) $counts['baby_flower'] += $amount;
                        if ($type === PlantCards::TRV_FLOWER) $counts['trv_flower'] += $amount;
                    }
                }

                $trvPlantsCount = $counts['trv_tree'] + $counts['trv_cactus'] + $counts['trv_flower'];

                foreach ($playerPlants as $plant) {
                    $plantInfo = self::$PLANT_CARD_TYPES[$plant['type']];
                    $bonus = $plantInfo['bonus_scoring'] ?? [];

                    if (isset($bonus['fixed_points'])) $score += $bonus['fixed_points'];
                    if (isset($bonus['per_two_cards_in_hand'])) $score += floor($cardsInHand / 2) * $bonus['per_two_cards_in_hand'];
                    if (isset($bonus['per_level3'])) $score += $counts['level3'] * $bonus['per_level3'];
                    if (isset($bonus['per_baby_tree'])) $score += $counts['baby_tree'] * $bonus['per_baby_tree'];
                    if (isset($bonus['per_trv_tree'])) $score += $counts['trv_tree'] * $bonus['per_trv_tree'];
                    if (isset($bonus['per_baby_cactus'])) $score += $counts['baby_cactus'] * $bonus['per_baby_cactus'];
                    if (isset($bonus['per_trv_cactus'])) $score += $counts['trv_cactus'] * $bonus['per_trv_cactus'];
                    if (isset($bonus['per_baby_flower'])) $score += $counts['baby_flower'] * $bonus['per_baby_flower'];
                    if (isset($bonus['per_trv_flower'])) $score += $counts['trv_flower'] * $bonus['per_trv_flower'];
                    if (isset($bonus['per_plant_type'])) $score += count($counts['plant_types']) * $bonus['per_plant_type'];
                }

                $scores[$playerId] = $score;

                $this->DbQuery("UPDATE player SET player_score = $score, player_score_aux = $trvPlantsCount WHERE player_id = $playerId");
            }

            $this->bga->notify->all("updateScores", "", [
                "scores" => $scores,
                "handCounts" => $handCounts,
            ]);

            return $scores;
        }

        function getCurrentPlayerId(): int { return $this->currentPlayerId; }
        function getPlayerNameById(int $id): string { return $this->players[$id]['name'] ?? "P$id"; }
        function loadPlayersBasicInfos(): array {
            $out = [];
            foreach ($this->players as $id => $p) $out[$id] = ['player_name' => $p['name']];
            return $out;
        }

        function DbQuery(string $sql): void {
            // Only the UPDATE patterns PlantingPhase.php actually issues.
            if (preg_match("/UPDATE player SET (.+) WHERE player_id = (\d+)/", $sql, $m)) {
                $this->applyAssignments($m[1], (int)$m[2]);
            } elseif (preg_match('/UPDATE player SET (.+)$/', $sql, $m)) {
                foreach (array_keys($this->players) as $pid) {
                    $this->applyAssignments($m[1], $pid);
                }
            } elseif (preg_match('/UPDATE plant_card SET card_type_arg = (\d+) WHERE card_id = (\d+)/', $sql, $m)) {
                $this->plantCards->cards[(int)$m[2]]['type_arg'] = (int)$m[1];
            }
        }

        /**
         * Split "col1 = 'val,with,commas', col2 = 5" on top-level commas
         * only — i.e. commas OUTSIDE single-quoted string literals. A naive
         * explode(',', ...) shreds JSON-blob values (which contain commas)
         * into garbage fragments. This tracks quote state character by
         * character instead.
         */
        private function splitTopLevel(string $s): array {
            $parts = []; $buf = ''; $inQuote = false;
            for ($i = 0; $i < strlen($s); $i++) {
                $ch = $s[$i];
                if ($ch === "'") $inQuote = !$inQuote;
                if ($ch === ',' && !$inQuote) {
                    $parts[] = $buf;
                    $buf = '';
                    continue;
                }
                $buf .= $ch;
            }
            if (trim($buf) !== '') $parts[] = $buf;
            return $parts;
        }

        private function applyAssignments(string $assignments, int $playerId): void {
            foreach ($this->splitTopLevel($assignments) as $part) {
                if (!preg_match("/(\w+)\s*=\s*'(.*)'$/s", trim($part), $mm)
                    && !preg_match("/(\w+)\s*=\s*(\S+)$/", trim($part), $mm)) continue;
                $col = $mm[1]; $val = $mm[2];
                $this->players[$playerId][$col] = $val;
            }
        }

        function getUniqueValueFromDb(string $sql) {
            // Column keys in $this->players use the REAL DB column names
            // (player_pending_effects, player_planting_status,
            // player_banana_used) so reads here line up with what
            // applyAssignments() writes when it parses raw UPDATE SQL —
            // using short/friendly key names for one side and not the
            // other was the harness bug that first broke this test.
            if (preg_match('/SELECT player_pending_effects FROM player WHERE player_id = (\d+)/', $sql, $m)) {
                return $this->players[(int)$m[1]]['player_pending_effects'] ?? '[]';
            }
            if (preg_match('/SELECT player_planting_status FROM player WHERE player_id = (\d+)/', $sql, $m)) {
                return $this->players[(int)$m[1]]['player_planting_status'] ?? 0;
            }
            if (preg_match('/SELECT player_banana_used FROM player WHERE player_id = (\d+)/', $sql, $m)) {
                return $this->players[(int)$m[1]]['player_banana_used'] ?? 0;
            }
            if (preg_match('/SELECT card_location_arg FROM planter_card WHERE card_id = (\d+)/', $sql, $m)) {
                return $this->planterCards->cards[(int)$m[1]]['location_arg'];
            }
            return null;
        }

        function getCollectionFromDb(string $sql): array {
            // Only used by playerHasGrowableBaby/AdultOfFamily — not exercised
            // by the Cattus scenario (no character claimed). Empty is fine.
            return [];
        }
    }
}
