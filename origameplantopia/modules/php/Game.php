<?php
/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * OrigamePlantopia implementation : © Marty Chang <marty.y.chang@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * Game.php
 *
 * This is the main file for your game logic.
 *
 * In this PHP file, you are going to defines the rules of the game.
 */
declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia;

use Bga\Games\OrigamePlantopia\PlantCards;
use Bga\Games\OrigamePlantopia\WeatherCards;
use Bga\Games\OrigamePlantopia\CharacterCards;
use Bga\Games\OrigamePlantopia\States\SetupDecisions;

use Bga\Games\OrigamePlantopia\States\PlantingPhase;
use Bga\Games\OrigamePlantopia\States\WeatherPhaseStart;
use Bga\GameFramework\Components\Counters\PlayerCounter;

class Game extends \Bga\GameFramework\Table
{
    /**
     * Material data for all plant card types.
     * Keyed by card name (= Deck card_type), populated in __construct().
     */
    public static array $PLANT_CARD_TYPES;
    public static array $WEATHER_CARD_TYPES;
    public static array $CHARACTER_CARD_TYPES;

    /** BGA Deck component for the 102 plant cards. */
    public \Bga\GameFramework\Components\Deck $plantCards;

    /** BGA Deck component for the 15 weather cards. */
    public \Bga\GameFramework\Components\Deck $weatherCards;

    /** BGA Deck component for the 5 character cards. */
    public \Bga\GameFramework\Components\Deck $characterCards;

    /** BGA Deck component for the planter cards. */
    public \Bga\GameFramework\Components\Deck $planterCards;

    public PlayerCounter $playerEnergy;

    /**
     * Your global variables labels:
     *
     * Here, you can assign labels to global variables you are using for this game. You can use any number of global
     * variables with IDs between 10 and 99. If you want to store any type instead of int, use $this->globals instead.
     *
     * NOTE: afterward, you can get/set the global variables with `getGameStateValue`, `setGameStateInitialValue` or
     * `setGameStateValue` functions.
     */
    public function __construct()
    {
        parent::__construct();

        $this->initGameStateLabels([
            'endgame_triggered' => 10,
        ]);


        $this->playerEnergy = $this->bga->counterFactory->createPlayerCounter('energy');

        // Plant cards Deck component — backed by 'plant_card' DB table
        $this->plantCards = $this->deckFactory->createDeck('plant_card');

        // Weather cards Deck component — backed by 'weather_card' DB table
        $this->weatherCards = $this->deckFactory->createDeck('weather_card');

        // Character cards Deck component — backed by 'character_card' DB table
        $this->characterCards = $this->deckFactory->createDeck('character_card');

        // Planter cards Deck component — backed by 'planter_card' DB table
        $this->planterCards = $this->deckFactory->createDeck('planter_card');

        // Load material data for all 32 plant card types
        self::$PLANT_CARD_TYPES = PlantCards::getTypes();
        // Load material data for all 15 weather card types
        self::$WEATHER_CARD_TYPES = WeatherCards::getTypes();
        // Load material data for all 5 character types
        self::$CHARACTER_CARD_TYPES = CharacterCards::getTypes();

        // Auto-complete player_name in notifications
        $this->bga->notify->addDecorator(function(string $message, array $args) {
            if (isset($args['player_id']) && !isset($args['player_name']) && str_contains($message, '${player_name}')) {
                $args['player_name'] = $this->getPlayerNameById($args['player_id']);
            }
            return $args;
        });
    }

    /**
     * Give every player standard extra time, per the BGA pre-release
     * checklist: "When giving their turn to a player, you give them some
     * extra time with giveExtraTime()". Called once per player each time
     * a MULTIPLE_ACTIVE_PLAYER state activates everyone via
     * setAllPlayersMultiactive() — i.e. right when their turn to act
     * begins, same as Marty observed in a live game of Splendor (30s per
     * activation, capped by BGA's own time-bank max — the cap and the
     * "standard" amount both come from the table's speed profile in
     * gameinfos.jsonc, not from our code). See https://trello.com/c/OSTxMchb.
     */
    public function giveExtraTimeToAllPlayers(): void
    {
        $players = $this->loadPlayersBasicInfos();
        foreach ($players as $playerId => $playerInfo) {
            $this->giveExtraTime((int)$playerId);
        }
    }

    /**
     * Count how many Adult (Treevolved) plants a player has — on a planter
     * (still growing) or already graduated to garden_level3. This is the
     * same count WeatherPhaseGrow::onEnteringState() uses to trigger
     * endgame (any player reaching 4 ends the game after one more Weather
     * Phase, per RULEBOOK.md), centralized here so both call sites agree.
     */
    public function countTreevolvedPlants(int $playerId): int
    {
        $count = 0;

        $plantsLevel3 = $this->plantCards->getCardsInLocation('garden_level3', $playerId);
        foreach ($plantsLevel3 as $plant) {
            if (PlantCards::isTreevolved($plant['type'])) {
                $count++;
            }
        }

        $plantsOnPlanters = $this->plantCards->getCardsInLocation('planter');
        foreach ($plantsOnPlanters as $plant) {
            $planter = $this->planterCards->getCard((int)$plant['location_arg']);
            if ($planter && (int)$planter['location_arg'] === $playerId && PlantCards::isTreevolved($plant['type'])) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * Recompute and persist the player statistics that mirror the at-a-
     * glance player panel (Game.js computePlayerStats()/renderPlayerPanel()):
     * hand count, Bonus Weather cards held by type, and garden plant
     * counts by family and maturity. Uses each card's own plant_type
     * directly, the same as the client's bumpPlant() — NOT the `treat_as`
     * mapping calculateAllScores() applies for bonus-scoring purposes,
     * which is a different (scoring) semantic, not what the panel shows.
     *
     * Called once per round (end of WeatherPhaseGrow, alongside the
     * total_rounds table stat) plus once at setup — not on every
     * individual notify, to keep this simple for the Alpha ship. See
     * https://trello.com/c/7kdTOK4l.
     */
    public function updatePlayerPanelStats(): void
    {
        $players = $this->loadPlayersBasicInfos();
        $handCounts = array_map('intval', $this->plantCards->countCardsByLocationArgs('hand'));

        $planters = $this->planterCards->getCardsInLocation('garden');
        $planterToPlayer = [];
        foreach ($planters as $planter) {
            $planterToPlayer[$planter['id']] = (int)$planter['location_arg'];
        }
        $plantsOnPlanters = $this->plantCards->getCardsInLocation('planter');
        $plantsLevel3 = $this->plantCards->getCardsInLocation('garden_level3');

        $bonusByPlayer = [];
        foreach ($this->weatherCards->getCardsInLocation('weather_public_bonus') as $card) {
            $pId = (int)$card['location_arg'];
            $cond = (int)$card['type_arg'];
            $bonusByPlayer[$pId][$cond] = ($bonusByPlayer[$pId][$cond] ?? 0) + 1;
        }

        foreach ($players as $playerId => $playerInfo) {
            $playerId = (int)$playerId;

            $counts = [
                PlantCards::BABY_CACTUS => 0, PlantCards::TRV_CACTUS => 0,
                PlantCards::BABY_FLOWER => 0, PlantCards::TRV_FLOWER => 0,
                PlantCards::BABY_TREE => 0, PlantCards::TRV_TREE => 0,
            ];
            foreach ($plantsOnPlanters as $plant) {
                if (($planterToPlayer[$plant['location_arg']] ?? null) === $playerId) {
                    $plantType = self::$PLANT_CARD_TYPES[$plant['type']]['plant_type'];
                    if (isset($counts[$plantType])) $counts[$plantType]++;
                }
            }
            foreach ($plantsLevel3 as $plant) {
                if ((int)$plant['location_arg'] === $playerId) {
                    $plantType = self::$PLANT_CARD_TYPES[$plant['type']]['plant_type'];
                    if (isset($counts[$plantType])) $counts[$plantType]++;
                }
            }

            $this->playerStats->set('hand_count', $handCounts[$playerId] ?? 0, $playerId);
            $this->playerStats->set('bonus_weather_sun', $bonusByPlayer[$playerId][WeatherCards::CONDITION_SUN] ?? 0, $playerId);
            $this->playerStats->set('bonus_weather_rain', $bonusByPlayer[$playerId][WeatherCards::CONDITION_RAIN] ?? 0, $playerId);
            $this->playerStats->set('bonus_weather_wind', $bonusByPlayer[$playerId][WeatherCards::CONDITION_WIND] ?? 0, $playerId);
            $this->playerStats->set('baby_cactus_count', $counts[PlantCards::BABY_CACTUS], $playerId);
            $this->playerStats->set('adult_cactus_count', $counts[PlantCards::TRV_CACTUS], $playerId);
            $this->playerStats->set('baby_flower_count', $counts[PlantCards::BABY_FLOWER], $playerId);
            $this->playerStats->set('adult_flower_count', $counts[PlantCards::TRV_FLOWER], $playerId);
            $this->playerStats->set('baby_tree_count', $counts[PlantCards::BABY_TREE], $playerId);
            $this->playerStats->set('adult_tree_count', $counts[PlantCards::TRV_TREE], $playerId);
        }
    }

    /**
     * Compute and return the current game progression.
     *
     * The number returned must be an integer between 0 and 100.
     *
     * This method is called each time we are in a game state with the "updateGameProgression" property set to true.
     *
     * Per RULEBOOK.md, the game ends once any player reaches 4 Adult
     * (Treevolved) plants — so the max Treevolved count across all players
     * is the natural top-level progress marker: 0/1/2/3/4+ Adult Plants
     * maps to 0%/25%/50%/75%/100%.
     *
     * @return int
     */
    public function getGameProgression()
    {
        $players = $this->loadPlayersBasicInfos();

        $maxTreevolved = 0;
        foreach ($players as $playerId => $playerInfo) {
            $count = $this->countTreevolvedPlants((int)$playerId);
            if ($count > $maxTreevolved) {
                $maxTreevolved = $count;
            }
        }

        return min(100, $maxTreevolved * 25);
    }

    /**
     * Migrate database.
     *
     * You don't have to care about this until your game has been published on BGA. Once your game is on BGA, this
     * method is called everytime the system detects a game running with your old database scheme. In this case, if you
     * change your database scheme, you just have to apply the needed changes in order to update the game database and
     * allow the game to continue to run with your new version.
     *
     * @param int $from_version
     * @return void
     */
    public function upgradeTableDb($from_version)
    {
//       if ($from_version <= 1404301345)
//       {
//            // ! important ! Use `DBPREFIX_<table_name>` for all tables
//
//            $sql = "ALTER TABLE `DBPREFIX_xxxxxxx` ....";
//            $this->applyDbUpgradeToAllDB( $sql );
//       }
//
//       if ($from_version <= 1405061421)
//       {
//            // ! important ! Use `DBPREFIX_<table_name>` for all tables
//
//            $sql = "CREATE TABLE `DBPREFIX_xxxxxxx` ....";
//            $this->applyDbUpgradeToAllDB( $sql );
//       }
    }

    /*
     * Gather all information about current game situation (visible by the current player).
     *
     * The method is called each time the game interface is displayed to a player, i.e.:
     *
     * - when the game starts
     * - when a player refreshes the game page (F5)
     */
    protected function getAllDatas(int $currentPlayerId): array
    {
        $result = [];
        // WARNING: We must only return information visible by the current player (using $currentPlayerId).

        // Get information about players.
        $result["players"] = $this->getCollectionFromDb(
            "SELECT `player_id` AS `id`, `player_score` AS `score`, `player_score_aux` AS `score_aux`, `player_mulligan_choice` AS `mulligan_choice`, `player_planting_status` AS `planting_status`, `player_pending_effects` AS `pending_effects` FROM `player`"
        );
        $this->playerEnergy->fillResult($result);

        // Material data — card type definitions (static, same for all players)
        $result['plantCardTypes'] = self::$PLANT_CARD_TYPES;
        $result['weatherCardTypes'] = self::$WEATHER_CARD_TYPES;
        $result['characterCardTypes'] = self::$CHARACTER_CARD_TYPES;

        // Current player's hand (private info)
        $result['hand'] = $this->plantCards->getCardsInLocation('hand', $currentPlayerId);
        
        // Hand counts of all players. Cast to int: the BGA Deck component
        // returns these as numeric strings (raw SQL COUNT results), and the
        // client does numeric `+=` on them across many notifications — a
        // stray string here poisons every subsequent update into string
        // concatenation instead of addition. See https://trello.com/c/vjsQX06a.
        $result['handCounts'] = array_map('intval', $this->plantCards->countCardsByLocationArgs('hand'));
        
        // Current player's weather hand (private info)
        $result['weatherHand'] = $this->weatherCards->getCardsInLocation('hand', $currentPlayerId);
        $result['weatherChosen'] = $this->weatherCards->getCardsInLocation('weather_chosen', $currentPlayerId);
        $result['weatherPublic'] = $this->weatherCards->getCardsInLocation('weather_public');
        $result['weatherPublicBonus'] = $this->weatherCards->getCardsInLocation('weather_public_bonus');
        // Bonus weather cards a player has *played* this round. Read by
        // WeatherPhaseGrow for growth contribution and cleared back to
        // bonus_deck at end of phase. See https://trello.com/c/B5g3UmED.
        $result['weatherPlayedBonus'] = $this->weatherCards->getCardsInLocation('weather_played_bonus');

        // Draft cards (if drafting)
        $result['draftCards'] = $this->plantCards->getCardsInLocation('draft', $currentPlayerId);

        // Deck and discard counts (public info, not the actual cards)
        $result['plantDeckCount'] = $this->plantCards->countCardInLocation('deck');
        $result['plantDiscardCount'] = $this->plantCards->countCardInLocation('discard');
        
        // Character cards (public info)
        $result['availableCharacters'] = $this->characterCards->getCardsInLocation('deck');
        $result['claimedCharacters'] = $this->characterCards->getCardsInLocation('garden');

        // Planter cards (public info)
        $result['planters'] = $this->planterCards->getCardsInLocation('garden');

        // Plants on planters
        $result['plantsOnPlanters'] = $this->plantCards->getCardsInLocation('planter');
        
        // Max level plants (off planter)
        $result['plantsLevel3'] = $this->plantCards->getCardsInLocation('garden_level3');

        // Bonus Weather cards in the market
        $result['bonusWeatherMarket'] = $this->weatherCards->getCardsOfTypeInLocation('bonus', null, 'bonus_deck');

        return $result;
    }

    /**
     * This method is called only once, when a new game is launched. In this method, you must setup the game
     *  according to the game rules, so that the game is ready to be played.
     */
    protected function setupNewGame($players, $options = [])
    {
        $this->playerEnergy->initDb(array_keys($players), initialValue: 2);

        // Set the colors of the players with HTML color code.
        $gameinfos = $this->getGameinfos();
        $default_colors = $gameinfos['player_colors'];

        foreach ($players as $player_id => $player) {
            $query_values[] = vsprintf("(%s, '%s', '%s')", [
                $player_id,
                array_shift($default_colors),
                addslashes($player["player_name"]),
            ]);
        }

        static::DbQuery(
            sprintf(
                "INSERT INTO `player` (`player_id`, `player_color`, `player_name`) VALUES %s",
                implode(",", $query_values)
            )
        );

        $this->reattributeColorsBasedOnPreferences($players, $gameinfos["player_colors"]);
        $this->reloadPlayersBasicInfos();

        // ── Create and shuffle the plant card deck (102 cards) ──────
        $this->plantCards->createCards(PlantCards::getDeckCards(), 'deck');
        $this->plantCards->shuffle('deck');

        // ── Create and shuffle the weather card deck (15 cards) ──────
        $this->weatherCards->createCards(WeatherCards::getDeckCards(), 'deck');
        $this->weatherCards->shuffle('deck');

        // ── Create the bonus weather deck (9 cards) ──────
        $this->weatherCards->createCards(WeatherCards::getBonusCards(), 'bonus_deck');

        // ── Create and shuffle the character card deck (5 cards) ──────
        $this->characterCards->createCards(CharacterCards::getDeckCards(), 'deck');
        $this->characterCards->shuffle('deck');

        // Deal initial hand of 6 plant cards to each player
        $playerList = $this->loadPlayersBasicInfos();
        foreach ($playerList as $player_id => $player_info) {
            $this->plantCards->pickCards(6, 'deck', $player_id);
            
            // Give each player 5 Planter cards in their garden
            $this->planterCards->createCards([
                ['type' => 'planter', 'type_arg' => 0, 'nbr' => 5]
            ], 'garden', $player_id);
        }

        $this->tableStats->init('total_rounds', 0);
        $this->playerStats->init([
            'hand_count', 'bonus_weather_sun', 'bonus_weather_rain', 'bonus_weather_wind',
            'baby_cactus_count', 'adult_cactus_count',
            'baby_flower_count', 'adult_flower_count',
            'baby_tree_count', 'adult_tree_count',
        ], 0);
        $this->updatePlayerPanelStats();

        // TODO: Create weather card deck once inventory is ready.

        // Activate first player (once setup logic is fully complete)
        $this->setGameStateInitialValue('endgame_triggered', 0);
        $this->activeNextPlayer();

        // Start the game in SetupDecisions
        return SetupDecisions::class;
    }

    /**
     * Example of debug function.
     * Here, jump to a state you want to test (by default, jump to next player state)
     * You can trigger it on Studio using the Debug button on the right of the top bar.
     */
    public function debug_goToState(int $state = 3) {
        $this->gamestate->jumpToState($state);
    }

    /**
     * Another example of debug function, to easily test the zombie code.
     */
    public function debug_playOneMove() {
        $this->bga->debug->playUntil(fn(int $count) => $count == 1);
    }

    /*
    Another example of debug function, to easily create situations you want to test.
    Here, put a card you want to test in your hand (assuming you use the Deck component).

    public function debug_setCardInHand(int $cardType, int $playerId) {
        $card = array_values($this->cards->getCardsOfType($cardType))[0];
        $this->cards->moveCard($card['id'], 'hand', $playerId);
    }
    }
    */

    /**
     * Calculates the score for all players, updates the database, and sends a notification.
     */
    public function calculateAllScores(): array
    {
        $players = $this->loadPlayersBasicInfos();
        // Cast to int for the same reason as getAllDatas above — this array
        // is also broadcast to the client in updateScores below.
        $handCounts = array_map('intval', $this->plantCards->countCardsByLocationArgs('hand'));
        // Per https://trello.com/c/K1iHgIDS (Marty confirmed with worked
        // examples): "cards in hand" for the per_two_cards_in_hand bonus
        // (Battus, Money Plant, Monte Carlo Tree — all read "including
        // all Weather Cards") counts BOTH held character weather cards
        // (weatherCards' 'hand' location) AND held Bonus Weather cards
        // (weatherCards' 'weather_public_bonus' location — see
        // https://trello.com/c/B5g3UmED for why Bonus Weather lives there
        // instead of 'hand'). "All Weather Cards" really does mean all of
        // them, regardless of which location holds them for game-state
        // reasons. Kept separate from $handCounts (plant-only) because
        // that variable is also broadcast in the updateScores
        // notification to drive the plant-hand-count display — this
        // scoring-only total must not leak into that.
        $weatherHandCounts = $this->weatherCards->countCardsByLocationArgs('hand');
        $weatherBonusCounts = $this->weatherCards->countCardsByLocationArgs('weather_public_bonus');

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
            $cardsInHand = ($handCounts[$playerId] ?? 0)
                + ($weatherHandCounts[$playerId] ?? 0)
                + ($weatherBonusCounts[$playerId] ?? 0);

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

            // Tiebreaker rules (https://trello.com/c/DTEJePl6):
            //   1. Most Adult Plants in Garden wins a tie.
            //   2. If still tied, most cards left in hand wins — using the
            //      same "cards in hand" definition Marty confirmed for
            //      Battus-style scoring (plant hand + character weather
            //      hand + held Bonus Weather — see https://trello.com/c/K1iHgIDS).
            //   3. If still tied, all tied players are Champions — BGA
            //      already treats equal score AND score_aux as a genuine
            //      tie in the ranking table, so no extra code is needed
            //      for this leaf case.
            // BGA exposes only one player_score_aux column for automatic
            // tie resolution, so both levels are packed into it: Adult
            // Plants in the thousands place, hand count in the units
            // place. A single player's hand count never approaches 1000
            // (the entire game is ~150 cards across all types), so the two
            // can't collide.
            $scoreAux = $trvPlantsCount * 1000 + $cardsInHand;

            $this->DbQuery("UPDATE player SET player_score = $score, player_score_aux = $scoreAux WHERE player_id = $playerId");
        }
        
        $this->bga->notify->all("updateScores", "", [
            "scores" => $scores,
            "handCounts" => $handCounts,
        ]);
        
        return $scores;
    }
}
