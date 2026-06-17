<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;

class PlantingPhase extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 31,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
        );
    }

    public function getArgs(): array
    {
        $players = $this->game->loadPlayersBasicInfos();
        $statuses = [];
        foreach ($players as $pId => $pInfo) {
            $statuses[$pId] = (int)$this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $pId");
        }
        return [
            'planting_statuses' => $statuses
        ];
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->game->gamestate->setAllPlayersMultiactive();
    }

    #[PossibleAction]
    public function actPlant(int $cardId, int $planterCardId, string $paymentCardIds)
    {
        $paymentCardIds = $paymentCardIds === '' ? [] : array_map('intval', explode(';', $paymentCardIds));
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        // 1. Check card is in hand
        $card = $this->game->plantCards->getCard($cardId);
        if ($card['location'] !== 'hand' || (int)$card['location_arg'] !== $playerId) {
            throw new UserException(clienttranslate("You do not have this card in your hand."));
        }

        // We'll check if the planter is empty AFTER validating the cost and sacrificing,
        // because the player might place the new treevolved plant on the same planter they sacrificed from.
        $planter = $this->game->planterCards->getCard($planterCardId);
        if ($planter['location'] !== 'garden' || (int)$planter['location_arg'] !== $playerId) {
            throw new UserException(clienttranslate("Invalid planter."));
        }

        // 3. Validate cost
        $plantType = $card['type'];
        $material = Game::$PLANT_CARD_TYPES[$plantType];
        $cost = $material['cost'];
        $costUnit = $material['cost_unit'];

        if (PlantCards::isBaby($plantType)) {
            if (count($paymentCardIds) !== $cost) {
                throw new UserException(clienttranslate("Incorrect number of cards provided for cost."));
            }
            if ($cost > 0) {
                foreach ($paymentCardIds as $paymentCardId) {
                    $pCard = $this->game->plantCards->getCard($paymentCardId);
                    if ($pCard['location'] !== 'hand' || (int)$pCard['location_arg'] !== $playerId) {
                        throw new UserException(clienttranslate("Payment cards must be from your hand."));
                    }
                    if ($pCard['id'] === $card['id']) {
                        throw new UserException(clienttranslate("You cannot pay with the card you are planting."));
                    }
                }
                $this->game->plantCards->moveCards($paymentCardIds, 'discard');
            }
        } else if (PlantCards::isTreevolved($plantType)) {
            // Need to pay a plant from garden of specific family and minimum level
            // Here $paymentCardIds should contain exactly 1 card ID (the plant in the garden to treevolve)
            if (count($paymentCardIds) !== 1) {
                throw new UserException(clienttranslate("You must sacrifice exactly one plant from your garden to treevolve."));
            }
            $sacrificedPlantId = $paymentCardIds[0];
            $sacrificedPlant = $this->game->plantCards->getCard($sacrificedPlantId);
            
            // Check if it's in the player's garden
            if ($sacrificedPlant['location'] !== 'planter' && $sacrificedPlant['location'] !== 'garden_level3') {
                throw new UserException(clienttranslate("The sacrificed plant must be in your garden."));
            }
            if ($sacrificedPlant['location'] === 'planter') {
                $pId = $this->game->getUniqueValueFromDb("SELECT card_location_arg FROM planter_card WHERE card_id = " . $sacrificedPlant['location_arg']);
                if ((int)$pId !== $playerId) throw new UserException(clienttranslate("This plant is not in your garden."));
            } else { // garden_level3
                if ((int)$sacrificedPlant['location_arg'] !== $playerId) throw new UserException(clienttranslate("This plant is not in your garden."));
            }

            // Check if it matches the required cost_unit (e.g. BABY_CACTUS)
            $sacrificedMaterial = Game::$PLANT_CARD_TYPES[$sacrificedPlant['type']];
            if ($sacrificedMaterial['plant_type'] !== $costUnit) {
                // Technically rulebook says: "pay a Baby or Treevolved Plant from your Garden of a specific type and a minimum level"
                // The cost_unit is the required baby type. Both the baby and treevolved versions of that family are acceptable.
                $requiredFamily = PlantCards::getFamily($costUnit);
                $sacrificedFamily = PlantCards::getFamily($sacrificedMaterial['plant_type']);
                if ($requiredFamily !== $sacrificedFamily) {
                    throw new UserException(clienttranslate("You must sacrifice a plant of the correct family."));
                }
            }

            // Check level requirement
            $sacrificedLevel = (int)$sacrificedPlant['type_arg'];
            if ($sacrificedLevel < $cost) {
                throw new UserException(clienttranslate("The sacrificed plant does not meet the minimum level requirement."));
            }

            // Valid! Discard it.
            $this->game->plantCards->moveCard($sacrificedPlantId, 'discard');
        }

        // Now check if planter is empty (it might have just been vacated!)
        $existingPlants = $this->game->plantCards->getCardsInLocation('planter', $planterCardId);
        if (count($existingPlants) > 0) {
            throw new UserException(clienttranslate("This planter is already occupied."));
        }

        // 4. Plant the card
        $this->game->plantCards->moveCard($cardId, 'planter', $planterCardId);
        // Set level to 0
        $this->game->DbQuery("UPDATE plant_card SET card_type_arg = 0 WHERE card_id = $cardId");

        $this->bga->notify->all("plantPlanted", clienttranslate('${player_name} planted ${plant_name}.'), [
            "player_id" => $playerId,
            "plant_name" => $material['name'],
            "card" => $this->game->plantCards->getCard($cardId),
            "planter_id" => $planterCardId,
        ]);

        // Queue and execute "Lightning" effects
        if (isset($material['planting_effect'])) {
            $this->queueEffects($playerId, $material['planting_effect'], $cardId);
        } else {
            $this->game->DbQuery("UPDATE player SET player_pending_effects = '[]' WHERE player_id = $playerId");
        }

        $this->processPendingEffects($playerId);
    }

    #[PossibleAction]
    public function actGrow(int $plantCardId, string $paymentCardIds)
    {
        $paymentCardIds = $paymentCardIds === '' ? [] : array_map('intval', explode(';', $paymentCardIds));
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        // 1. Check plant is in player's garden and not already max level
        $plant = $this->game->plantCards->getCard($plantCardId);
        if ($plant['location'] !== 'planter') {
            throw new UserException(clienttranslate("You can only grow plants that are on a planter."));
        }
        $pId = $this->game->getUniqueValueFromDb("SELECT card_location_arg FROM planter_card WHERE card_id = " . $plant['location_arg']);
        if ((int)$pId !== $playerId) {
            throw new UserException(clienttranslate("This plant is not in your garden."));
        }

        $level = (int)$plant['type_arg'];
        if ($level >= 3) {
            throw new UserException(clienttranslate("This plant is already at maximum level."));
        }

        // 2. Validate cost
        $material = Game::$PLANT_CARD_TYPES[$plant['type']];
        $cost = $material['cost'];

        if (count($paymentCardIds) !== $cost) {
            throw new UserException(clienttranslate("Incorrect number of cards provided for fertilizer."));
        }

        if ($cost > 0) {
            foreach ($paymentCardIds as $paymentCardId) {
                $pCard = $this->game->plantCards->getCard($paymentCardId);
                if ($pCard['location'] !== 'hand' || (int)$pCard['location_arg'] !== $playerId) {
                    throw new UserException(clienttranslate("Payment cards must be from your hand."));
                }
            }
            $this->game->plantCards->moveCards($paymentCardIds, 'discard');
        }

        // 3. Grow the plant
        $newLevel = $level + 1;
        $this->game->DbQuery("UPDATE plant_card SET card_type_arg = $newLevel WHERE card_id = $plantCardId");

        // Handle Max Level Rules (tilt and remove from planter)
        if ($newLevel === 3) {
            $this->game->plantCards->moveCard($plantCardId, 'garden_level3', $playerId);
        }

        $this->bga->notify->all("plantGrown", clienttranslate('${player_name} grew their ${plant_name} to level ${level}.'), [
            "player_id" => $playerId,
            "plant_name" => $material['name'],
            "card_id" => $plantCardId,
            "level" => $newLevel,
            "max_level" => ($newLevel === 3)
        ]);

        $this->markPlayerDone($playerId);
    }

    #[PossibleAction]
    public function actRequestDraw5()
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        $this->bga->notify->all("playerStartedDrafting", clienttranslate('${player_name} chose to draw 5 and keep 2.'), [
            "player_id" => $playerId,
            "player_name" => $this->game->getPlayerNameById($playerId),
        ]);

        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode([['type' => 'draft_cards', 'draw' => 5, 'keep' => 2]]) . "' WHERE player_id = $playerId");
        $this->processPendingEffects($playerId);
    }

    #[PossibleAction]
    public function actResolveDraft(string $cardIdsStr)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        
        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || $queue[0]['type'] !== 'draft_cards') {
            throw new UserException(clienttranslate("You are not currently choosing cards."));
        }

        $draftCards = $this->game->plantCards->getCardsInLocation('draft', $playerId);
        $cardIds = $cardIdsStr === '' ? [] : array_map('intval', explode(';', $cardIdsStr));
        $keepQty = $queue[0]['keep'];

        if (count($cardIds) !== $keepQty) {
            if (count($draftCards) > $keepQty) {
                throw new UserException(clienttranslate("You must choose exactly ${keepQty} card(s)."));
            } else if (count($cardIds) !== count($draftCards)) {
                throw new UserException(clienttranslate("You must choose all available cards."));
            }
        }

        foreach ($cardIds as $cId) {
            if (!isset($draftCards[$cId])) {
                throw new UserException(clienttranslate("Invalid card choice."));
            }
        }

        // Keep chosen cards, discard the rest
        if (count($cardIds) > 0) {
            $this->game->plantCards->moveCards($cardIds, 'hand', $playerId);
        }
        
        $discardIds = [];
        foreach ($draftCards as $cId => $c) {
            if (!in_array($cId, $cardIds)) {
                $discardIds[] = $cId;
            }
        }
        if (count($discardIds) > 0) {
            $this->game->plantCards->moveCards($discardIds, 'discard');
        }

        $keptCards = [];
        foreach ($cardIds as $cId) {
            $keptCards[] = $this->game->plantCards->getCard($cId);
        }

        $this->bga->notify->player($playerId, "keptCards", '', [
            "cards" => $keptCards
        ]);

        $this->bga->notify->all("playerKeptDraft", clienttranslate('${player_name} kept ${qty} card(s).'), [
            "player_id" => $playerId,
            "player_name" => $this->game->getPlayerNameById($playerId),
            "qty" => count($cardIds)
        ]);

        array_shift($queue);
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        $this->processPendingEffects($playerId);
    }

    private function queueEffects(int $playerId, array $effectDef, int $sourceCardId)
    {
        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        
        if (isset($effectDef['draw_cards'])) {
            $queue[] = ['type' => 'draw_cards', 'qty' => $effectDef['draw_cards']];
        }
        if (isset($effectDef['draft_cards'])) {
            $queue[] = ['type' => 'draft_cards', 'draw' => $effectDef['draft_cards'], 'keep' => $effectDef['keep_cards']];
        }
        if (isset($effectDef['discard_cards'])) {
            $queue[] = ['type' => 'discard_cards', 'qty' => $effectDef['discard_cards']];
        }
        if (isset($effectDef['gain_weather_type'])) {
            $queue[] = ['type' => 'gain_weather', 'weather_type' => $effectDef['gain_weather_type'], 'qty' => $effectDef['gain_weather_qty'] ?? 1];
        }
        if (isset($effectDef['level_up'])) {
            $queue[] = ['type' => 'level_up', 'target' => $effectDef['level_up'], 'qty' => $effectDef['level_up_qty'] ?? 1, 'source_card_id' => $sourceCardId];
        }
        if (isset($effectDef['level_up_family'])) {
            $queue[] = ['type' => 'level_up_family', 'qty' => 1];
        }
        if (isset($effectDef['gain_action'])) {
            $queue[] = ['type' => 'gain_action'];
        }
        
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
    }

    private function processPendingEffects(int $playerId)
    {
        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        
        $gainedAction = false;

        while (count($queue) > 0) {
            $effect = $queue[0];
            
            if ($effect['type'] === 'draw_cards') {
                $numToDraw = $effect['qty'];
                $drawn = $this->game->plantCards->pickCards($numToDraw, 'deck', $playerId) ?? [];
                if (count($drawn) < $numToDraw) {
                    $this->game->plantCards->moveAllCardsInLocation('discard', 'deck');
                    $this->game->plantCards->shuffle('deck');
                    $this->bga->notify->all('message', clienttranslate('The plant deck is empty. Reshuffling the discard pile...'), []);
                    $remaining = $numToDraw - count($drawn);
                    $drawn2 = $this->game->plantCards->pickCards($remaining, 'deck', $playerId) ?? [];
                    $drawn = array_merge($drawn, $drawn2);
                }
                $this->bga->notify->player($playerId, "cardsDrawn", '', ["cards" => $drawn]);
                $this->bga->notify->all("playerDrewCard", clienttranslate('${player_name} drew cards from planting effect.'), ["player_id" => $playerId]);
                array_shift($queue);
            }
            else if ($effect['type'] === 'draft_cards') {
                $draftCards = $this->game->plantCards->getCardsInLocation('draft', $playerId);
                if (count($draftCards) === 0) {
                    $numToDraw = $effect['draw'];
                    $drawn = $this->game->plantCards->pickCardsForLocation($numToDraw, 'deck', 'draft', $playerId) ?? [];
                    if (count($drawn) < $numToDraw) {
                        $this->game->plantCards->moveAllCardsInLocation('discard', 'deck');
                        $this->game->plantCards->shuffle('deck');
                        $this->bga->notify->all('message', clienttranslate('The plant deck is empty. Reshuffling the discard pile...'), []);
                        $remaining = $numToDraw - count($drawn);
                        $drawn2 = $this->game->plantCards->pickCardsForLocation($remaining, 'deck', 'draft', $playerId) ?? [];
                        $drawn = array_merge($drawn, $drawn2);
                    }
                    $this->bga->notify->player($playerId, "draftCards", '', [
                        "cards" => $this->game->plantCards->getCardsInLocation('draft', $playerId)
                    ]);
                }
                break;
            }
            else if ($effect['type'] === 'gain_action') {
                $gainedAction = true;
                array_shift($queue);
            }
            else if ($effect['type'] === 'level_up' && $effect['target'] === PlantCards::LEVEL_UP_THIS) {
                $cardId = $effect['source_card_id'];
                $plant = $this->game->plantCards->getCard($cardId);
                if ($plant && $plant['location'] === 'planter') {
                    $level = (int)$plant['type_arg'];
                    $newLevel = min(3, $level + $effect['qty']);
                    $this->game->DbQuery("UPDATE plant_card SET card_type_arg = $newLevel WHERE card_id = $cardId");
                    if ($newLevel === 3) {
                        $this->game->plantCards->moveCard($cardId, 'garden_level3', $playerId);
                    }
                    $material = Game::$PLANT_CARD_TYPES[$plant['type']];
                    $this->bga->notify->all("plantGrown", clienttranslate('${player_name} automatically grew their ${plant_name} to level ${level}.'), [
                        "player_id" => $playerId,
                        "plant_name" => $material['name'],
                        "card_id" => $cardId,
                        "level" => $newLevel,
                        "max_level" => ($newLevel === 3)
                    ]);
                }
                array_shift($queue);
            }
            else if ($effect['type'] === 'gain_weather' && $effect['weather_type'] !== PlantCards::WEATHER_ANY) {
                $cards = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', $effect['weather_type'], 'bonus_deck');
                if (count($cards) > 0) {
                    $card = array_values($cards)[0];
                    $this->game->weatherCards->moveCard($card['id'], 'hand', $playerId);
                    $this->bga->notify->player($playerId, "weatherCardsDrawn", '', ["cards" => [$card]]);
                    $this->bga->notify->all("playerGainedWeather", clienttranslate('${player_name} gained a Bonus ${weather_name} Card.'), [
                        "player_id" => $playerId,
                        "weather_name" => ucfirst($effect['weather_type'])
                    ]);
                } else {
                    $market = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', null, 'bonus_deck');
                    if (count($market) > 0) {
                        $queue[0]['weather_type'] = PlantCards::WEATHER_ANY;
                        continue;
                    }
                }
                array_shift($queue);
            }
            else {
                // Interactive effect, pause
                break;
            }
        }
        
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        
        if (count($queue) > 0) {
            $this->game->DbQuery("UPDATE player SET player_planting_status = 3 WHERE player_id = $playerId");
            $this->bga->notify->player($playerId, "pendingEffects", '', [
                "effects" => $queue
            ]);
            $this->bga->notify->all("playerResolvingEffects", clienttranslate('${player_name} is resolving plant effects.'), [
                "player_id" => $playerId,
            ]);
        } else {
            $status = (int)$this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $playerId");
            if (!$gainedAction && $status !== 1) {
                $this->markPlayerDone($playerId);
            } else if ($gainedAction) {
                $this->game->DbQuery("UPDATE player SET player_planting_status = 0 WHERE player_id = $playerId");
                $this->bga->notify->all("playerGainedAction", clienttranslate('${player_name} immediately takes another Planting Phase action.'), [
                    "player_id" => $playerId,
                    "player_name" => $this->game->getPlayerNameById($playerId),
                ]);
            }
        }
    }

    #[PossibleAction]
    public function actResolveDiscard(string $cardIdsStr)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || $queue[0]['type'] !== 'discard_cards') {
            throw new UserException(clienttranslate("You do not need to discard cards right now."));
        }

        $cardIds = $cardIdsStr === '' ? [] : array_map('intval', explode(';', $cardIdsStr));
        $qty = $queue[0]['qty'];
        if (count($cardIds) !== $qty) {
            // Check if player has enough cards in hand
            $handCount = (int)$this->game->plantCards->countCardInLocation('hand', $playerId);
            if ($handCount >= $qty) {
                throw new UserException(clienttranslate("You must discard exactly ${qty} cards."));
            } else if (count($cardIds) !== $handCount) {
                throw new UserException(clienttranslate("You must discard all your cards."));
            }
        }

        foreach ($cardIds as $cId) {
            $card = $this->game->plantCards->getCard($cId);
            if ($card['location'] !== 'hand' || (int)$card['location_arg'] !== $playerId) {
                throw new UserException(clienttranslate("You can only discard cards from your hand."));
            }
        }

        if (count($cardIds) > 0) {
            $this->game->plantCards->moveCards($cardIds, 'discard');
            $this->bga->notify->all("playerDiscardedCards", clienttranslate('${player_name} discarded ${qty} cards from their hand.'), [
                "player_id" => $playerId,
                "player_name" => $this->game->getPlayerNameById($playerId),
                "qty" => count($cardIds)
            ]);
        }

        array_shift($queue);
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        $this->processPendingEffects($playerId);
    }

    #[PossibleAction]
    public function actResolveGainWeather(int $cardId)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || $queue[0]['type'] !== 'gain_weather') {
            throw new UserException(clienttranslate("You are not supposed to gain a weather card right now."));
        }

        $card = $this->game->weatherCards->getCard($cardId);
        if ($card['location'] !== 'bonus_deck') {
            throw new UserException(clienttranslate("This weather card is not available."));
        }

        $this->game->weatherCards->moveCard($cardId, 'hand', $playerId);
        $this->bga->notify->player($playerId, "weatherCardsDrawn", '', ["cards" => [$card]]);
        $this->bga->notify->all("playerGainedWeather", clienttranslate('${player_name} gained a Bonus Weather Card.'), [
            "player_id" => $playerId,
        ]);

        $queue[0]['qty']--;
        if ($queue[0]['qty'] <= 0) {
            array_shift($queue);
        }
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        $this->processPendingEffects($playerId);
    }

    #[PossibleAction]
    public function actResolveLevelUp(int $plantCardId)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || ($queue[0]['type'] !== 'level_up' && $queue[0]['type'] !== 'level_up_family')) {
            throw new UserException(clienttranslate("You do not have a level up effect to resolve."));
        }

        $effect = $queue[0];
        $qty = $effect['qty'];

        $plant = $this->game->plantCards->getCard($plantCardId);
        if ($plant['location'] !== 'planter') {
            throw new UserException(clienttranslate("You can only grow plants that are on a planter."));
        }
        $pId = $this->game->getUniqueValueFromDb("SELECT card_location_arg FROM planter_card WHERE card_id = " . $plant['location_arg']);
        if ((int)$pId !== $playerId) {
            throw new UserException(clienttranslate("This plant is not in your garden."));
        }
        $level = (int)$plant['type_arg'];
        if ($level >= 3) {
            throw new UserException(clienttranslate("This plant is already at maximum level."));
        }

        if ($effect['type'] === 'level_up') {
            if ($effect['target'] === PlantCards::LEVEL_UP_OTHER && $plantCardId === $effect['source_card_id']) {
                throw new UserException(clienttranslate("You must select a different plant to grow."));
            }
            if ($effect['target'] === PlantCards::LEVEL_UP_BABY && !PlantCards::isBaby($plant['type'])) {
                throw new UserException(clienttranslate("You must select a Baby plant to grow."));
            }
        }

        $newLevel = min(3, $level + $qty);
        $this->game->DbQuery("UPDATE plant_card SET card_type_arg = $newLevel WHERE card_id = $plantCardId");
        if ($newLevel === 3) {
            $this->game->plantCards->moveCard($plantCardId, 'garden_level3', $playerId);
        }

        $material = Game::$PLANT_CARD_TYPES[$plant['type']];
        $this->bga->notify->all("plantGrown", clienttranslate('${player_name} grew their ${plant_name} to level ${level}.'), [
            "player_id" => $playerId,
            "plant_name" => $material['name'],
            "card_id" => $plantCardId,
            "level" => $newLevel,
            "max_level" => ($newLevel === 3)
        ]);

        array_shift($queue);
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        $this->processPendingEffects($playerId);
    }

    #[PossibleAction]
    public function actResolveLevelUpFamily(string $family)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || $queue[0]['type'] !== 'level_up_family') {
            throw new UserException(clienttranslate("You do not have a family level up effect to resolve."));
        }

        if (!in_array($family, ['tree', 'flower', 'cactus'])) {
            throw new UserException(clienttranslate("Invalid plant type."));
        }

        $qty = $queue[0]['qty'];
        $plants = $this->game->plantCards->getCardsInLocation('planter');
        
        $grownNames = [];
        foreach ($plants as $plant) {
            $pId = $this->game->getUniqueValueFromDb("SELECT card_location_arg FROM planter_card WHERE card_id = " . $plant['location_arg']);
            if ((int)$pId === $playerId) {
                $material = Game::$PLANT_CARD_TYPES[$plant['type']];
                if (PlantCards::getFamily($material['plant_type']) === $family) {
                    $level = (int)$plant['type_arg'];
                    if ($level < 3) {
                        $newLevel = min(3, $level + $qty);
                        $this->game->DbQuery("UPDATE plant_card SET card_type_arg = $newLevel WHERE card_id = " . $plant['id']);
                        if ($newLevel === 3) {
                            $this->game->plantCards->moveCard($plant['id'], 'garden_level3', $playerId);
                        }
                        $grownNames[] = $material['name'];
                        
                        $this->bga->notify->all("plantGrown", '', [
                            "player_id" => $playerId,
                            "plant_name" => $material['name'],
                            "card_id" => $plant['id'],
                            "level" => $newLevel,
                            "max_level" => ($newLevel === 3)
                        ]);
                    }
                }
            }
        }

        if (count($grownNames) > 0) {
            $this->bga->notify->all("message", clienttranslate('${player_name} grew all their ${family} plants: ${grown}'), [
                "player_id" => $playerId,
                "player_name" => $this->game->getPlayerNameById($playerId),
                "family" => $family,
                "grown" => implode(", ", $grownNames)
            ]);
        } else {
            $this->bga->notify->all("message", clienttranslate('${player_name} chose to grow all their ${family} plants, but none could grow.'), [
                "player_id" => $playerId,
                "player_name" => $this->game->getPlayerNameById($playerId),
                "family" => $family,
            ]);
        }

        array_shift($queue);
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        $this->processPendingEffects($playerId);
    }

    private function checkActionAllowed(int $playerId)
    {
        $status = $this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $playerId");
        if ((int)$status === 1) {
            throw new UserException(clienttranslate("You have already performed your planting action."));
        }
        if ((int)$status === 2) {
            throw new UserException(clienttranslate("You must choose a card to keep."));
        }
    }

    private function markPlayerDone(int $playerId)
    {
        $this->game->DbQuery("UPDATE player SET player_planting_status = 1 WHERE player_id = $playerId");
        $this->game->gamestate->setPlayerNonMultiactive($playerId, WeatherPhaseStart::class);
    }

    function zombie(int $playerId) {
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '[]' WHERE player_id = $playerId");
        $this->markPlayerDone($playerId);
    }
}
