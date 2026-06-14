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
        return [];
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->game->gamestate->setAllPlayersMultiactive();
    }

    #[PossibleAction]
    public function actPlant(int $cardId, int $planterCardId, array $paymentCardIds)
    {
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

        // Execute "Lightning" effects
        if (isset($material['planting_effect'])) {
            $this->executePlantingEffect($playerId, $material['planting_effect']);
        }

        $this->markPlayerDone($playerId);
    }

    #[PossibleAction]
    public function actGrow(int $plantCardId, array $paymentCardIds)
    {
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

        // Draw 5 cards to 'draft' location
        $drawn = $this->game->plantCards->pickCardsForLocation(5, 'deck', 'draft', $playerId) ?? [];
        if (count($drawn) < 5) {
            // Reshuffle and draw remaining
            $this->game->plantCards->moveAllCardsInLocation('discard', 'deck');
            $this->game->plantCards->shuffle('deck');
            $remaining = 5 - count($drawn);
            $drawn2 = $this->game->plantCards->pickCardsForLocation($remaining, 'deck', 'draft', $playerId) ?? [];
            $drawn = array_merge($drawn, $drawn2);
        }

        // Update status to drafting
        $this->game->DbQuery("UPDATE player SET player_planting_status = 2 WHERE player_id = $playerId");

        $this->bga->notify->player($playerId, "draftCards", '', [
            "cards" => $this->game->plantCards->getCardsInLocation('draft', $playerId)
        ]);
        
        $this->bga->notify->all("playerStartedDrafting", clienttranslate('${player_name} chose to draw 5 and keep 1.'), [
            "player_id" => $playerId,
        ]);
    }

    #[PossibleAction]
    public function actKeepFromDraw5(int $cardId)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        
        $status = $this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $playerId");
        if ((int)$status !== 2) {
            throw new UserException(clienttranslate("You are not currently choosing a card."));
        }

        $draftCards = $this->game->plantCards->getCardsInLocation('draft', $playerId);
        if (!isset($draftCards[$cardId])) {
            throw new UserException(clienttranslate("Invalid card choice."));
        }

        // Keep chosen card, discard the rest
        $this->game->plantCards->moveCard($cardId, 'hand', $playerId);
        
        $discardIds = [];
        foreach ($draftCards as $cId => $c) {
            if ($cId !== $cardId) {
                $discardIds[] = $cId;
            }
        }
        $this->game->plantCards->moveCards($discardIds, 'discard');

        $this->bga->notify->player($playerId, "keptCard", '', [
            "card" => $this->game->plantCards->getCard($cardId)
        ]);

        $this->bga->notify->all("playerKeptDraft", clienttranslate('${player_name} kept 1 card.'), [
            "player_id" => $playerId,
        ]);

        $this->markPlayerDone($playerId);
    }

    private function executePlantingEffect(int $playerId, array $effect)
    {
        // Simple effects like draw cards, discard cards, gain weather cards
        if (isset($effect['draw_cards'])) {
            $drawn = $this->game->plantCards->pickCards($effect['draw_cards'], 'deck', $playerId);
            $this->bga->notify->player($playerId, "cardsDrawn", '', ["cards" => $drawn]);
            $this->bga->notify->all("playerDrewCard", clienttranslate('${player_name} drew cards from planting effect.'), ["player_id" => $playerId]);
        }
        
        // Other effects like discard cards or gain action would need more complex state handling.
        // For simplicity, we just process the automated ones or queue substates.
        // Note: Full implementation of lightning effects might require substates.
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
        $this->markPlayerDone($playerId);
    }
}
