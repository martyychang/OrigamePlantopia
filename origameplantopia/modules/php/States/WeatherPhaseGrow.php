<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;

class WeatherPhaseGrow extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 44,
            type: StateType::GAME,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        $players = $this->game->loadPlayersBasicInfos();
        
        // 1. Calculate base weather conditions from public cards
        $publicCards = $this->game->weatherCards->getCardsInLocation('weather_public');
        $baseConditions = [0 => 0, 1 => 0, 2 => 0]; // SUN, RAIN, WIND
        foreach ($publicCards as $c) {
            $baseConditions[(int)$c['type_arg']]++;
        }

        // 2. Process growth for each player
        foreach ($players as $pId => $pInfo) {
            // Player's bonus weather
            $bonusCards = $this->game->weatherCards->getCardsInLocation('weather_public_bonus', $pId);
            $playerConditions = $baseConditions;
            foreach ($bonusCards as $c) {
                $playerConditions[(int)$c['type_arg']]++;
            }

            // Find player's plants on planters
            $plants = $this->game->plantCards->getCardsInLocation('planter');
            $playerPlants = [];
            foreach ($plants as $plant) {
                $planter = $this->game->planterCards->getCard((int)$plant['location_arg']);
                if ($planter && (int)$planter['location_arg'] === $pId) {
                    $playerPlants[] = $plant;
                }
            }

            foreach ($playerPlants as $plant) {
                $level = (int)$plant['type_arg'];
                if ($level >= 3) continue;

                $material = Game::$PLANT_CARD_TYPES[$plant['type']];
                $reqs = $material['growth']; // array with 'sun', 'rain', 'wind' keys
                
                // Need to match $reqs keys to 0, 1, 2 constants
                // 0 = SUN, 1 = RAIN, 2 = WIND
                $reqCounts = [
                    0 => $reqs['sun'] ?? 0,
                    1 => $reqs['rain'] ?? 0,
                    2 => $reqs['wind'] ?? 0,
                ];
                
                $timesMet = 999;
                $hasRequirements = false;
                foreach ($reqCounts as $reqCond => $reqAmount) {
                    if ($reqAmount > 0) {
                        $hasRequirements = true;
                        $possible = floor($playerConditions[$reqCond] / $reqAmount);
                        if ($possible < $timesMet) {
                            $timesMet = (int)$possible;
                        }
                    }
                }
                
                if (!$hasRequirements) $timesMet = 0;

                if ($timesMet > 0) {
                    $newLevel = min(3, $level + $timesMet);
                    $this->game->DbQuery("UPDATE plant_card SET card_type_arg = $newLevel WHERE card_id = " . $plant['id']);
                    
                    if ($newLevel === 3) {
                        $this->game->plantCards->moveCard((int)$plant['id'], 'garden_level3', $pId);
                    }

                    $this->bga->notify->all("plantGrown", clienttranslate('${player_name}\'s ${plant_name} grew to level ${level}.'), [
                        "player_id" => $pId,
                        "plant_name" => $material['name'],
                        "card_id" => (int)$plant['id'],
                        "level" => $newLevel,
                        "max_level" => ($newLevel === 3)
                    ]);
                }
            }

            // Return character weather cards to player's hand
            $chars = $this->game->characterCards->getCardsInLocation('garden', $pId);
            if (count($chars) > 0) {
                $charType = array_values($chars)[0]['type'];
                $publicCharCards = $this->game->weatherCards->getCardsOfTypeInLocation($charType, null, 'weather_public');
                $returnedCards = [];
                foreach ($publicCharCards as $c) {
                    $this->game->weatherCards->moveCard((int)$c['id'], 'hand', $pId);
                    $returnedCards[] = $this->game->weatherCards->getCard((int)$c['id']);
                }
                if (count($returnedCards) > 0) {
                    $this->bga->notify->player($pId, "receivedWeatherCards", '', [
                        "cards" => $returnedCards
                    ]);
                }
            }
        }
        
        // 3. Clean up
        $this->game->weatherCards->moveAllCardsInLocation('weather_public', 'discard');
        // Bonus cards go back to supply/deck
        $this->game->weatherCards->moveAllCardsInLocation('weather_public_bonus', 'bonus_deck'); 

        $bonusMarket = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', null, 'bonus_deck');
        $this->bga->notify->all("weatherCleared", '', [
            "bonusMarket" => $bonusMarket
        ]);

        // 4. Check for endgame
        // If someone has 4 Treevolved plants, set endgame flag if not already set
        $endgameTriggered = (int)$this->game->getGameStateValue('endgame_triggered');
        if ($endgameTriggered === 0) {
            foreach ($players as $pId => $pInfo) {
                $plantsOnPlanters = $this->game->plantCards->getCardsInLocation('planter');
                $plantsLevel3 = $this->game->plantCards->getCardsInLocation('garden_level3', $pId);
                
                $treevolvedCount = 0;
                foreach ($plantsLevel3 as $plant) {
                    if (PlantCards::isTreevolved($plant['type'])) {
                        $treevolvedCount++;
                    }
                }
                foreach ($plantsOnPlanters as $plant) {
                    $planter = $this->game->planterCards->getCard((int)$plant['location_arg']);
                    if ($planter && (int)$planter['location_arg'] === $pId) {
                        if (PlantCards::isTreevolved($plant['type'])) {
                            $treevolvedCount++;
                        }
                    }
                }

                if ($treevolvedCount >= 4) {
                    $this->game->setGameStateValue('endgame_triggered', 1);
                    $this->bga->notify->all("message", clienttranslate('${player_name} has built 4 Treevolved plants! This is the final round!'), [
                        "player_id" => $pId,
                        "player_name" => $pInfo['player_name']
                    ]);
                    break;
                }
            }
        }

        $endgameTriggered = (int)$this->game->getGameStateValue('endgame_triggered');
        if ($endgameTriggered === 1) {
            return EndScore::class;
        }

        return PlantingPhaseStart::class;
    }
}
