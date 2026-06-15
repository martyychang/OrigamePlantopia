<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\OrigamePlantopia\Game;

class SetupDecisions extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 20,
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
    public function actKeep()
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        if ($this->hasMulliganed($activePlayerId)) {
            throw new UserException(clienttranslate("You have already made your mulligan decision."));
        }

        $this->game->DbQuery("UPDATE player SET player_mulligan_choice = 1 WHERE player_id = $activePlayerId");

        $this->bga->notify->all("playerKeptCards", clienttranslate('${player_name} kept their starting hand.'), [
            "player_id" => $activePlayerId,
        ]);

        $this->checkIfAllPlayersReady();
    }

    #[PossibleAction]
    public function actRedraw()
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        if ($this->hasMulliganed($activePlayerId)) {
            throw new UserException(clienttranslate("You have already made your mulligan decision."));
        }

        $this->game->DbQuery("UPDATE player SET player_mulligan_choice = 2 WHERE player_id = $activePlayerId");

        // Player discards their 6 cards and draws 6 new ones.
        $hand = $this->game->plantCards->getCardsInLocation('hand', $activePlayerId);
        
        $cardIds = array_column($hand, 'id');
        $this->game->plantCards->moveCards($cardIds, 'discard');

        $this->game->plantCards->pickCards(6, 'deck', $activePlayerId);
        $newHand = $this->game->plantCards->getCardsInLocation('hand', $activePlayerId);

        $this->bga->notify->player($activePlayerId, "newHand", '', [
            "cards" => $newHand
        ]);

        $this->bga->notify->all("playerRedrewCards", clienttranslate('${player_name} redrew their starting hand.'), [
            "player_id" => $activePlayerId,
        ]);

        $this->checkIfAllPlayersReady();
    }

    #[PossibleAction]
    public function actClaimCharacter(int $cardId)
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        if (!$this->hasMulliganed($activePlayerId)) {
            throw new UserException(clienttranslate("You must keep or redraw your hand first."));
        }

        // Ensure player doesn't already have a character
        $existing = $this->game->characterCards->getCardsInLocation('garden', $activePlayerId);
        if (count($existing) > 0) {
            throw new UserException(clienttranslate("You have already claimed a character."));
        }

        $card = $this->game->characterCards->getCard($cardId);
        if ($card['location'] !== 'deck') {
            throw new UserException(clienttranslate("This character has already been claimed."));
        }

        $this->game->characterCards->moveCard($cardId, 'garden', $activePlayerId);

        $this->bga->notify->all("characterClaimed", clienttranslate('${player_name} claimed the ${character_name} character.'), [
            "player_id" => $activePlayerId,
            "card" => $this->game->characterCards->getCard($cardId),
            "character_name" => Game::$CHARACTER_CARD_TYPES[$card['type']]['name']
        ]);

        $this->checkIfAllPlayersReady();
    }

    #[PossibleAction]
    public function actReturnCharacter(int $cardId)
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        $card = $this->game->characterCards->getCard($cardId);
        if ($card['location'] !== 'garden' || (int)$card['location_arg'] !== $activePlayerId) {
            throw new UserException(clienttranslate("You can only return a character you have claimed."));
        }

        $this->game->characterCards->moveCard($cardId, 'deck');

        $this->bga->notify->all("characterReturned", clienttranslate('${player_name} returned the ${character_name} character.'), [
            "player_id" => $activePlayerId,
            "card" => $this->game->characterCards->getCard($cardId),
            "character_name" => Game::$CHARACTER_CARD_TYPES[$card['type']]['name']
        ]);
    }

    private function hasMulliganed(int $playerId): bool
    {
        $val = $this->game->getUniqueValueFromDb("SELECT player_mulligan_choice FROM player WHERE player_id = $playerId");
        return (int)$val > 0;
    }

    private function checkIfAllPlayersReady()
    {
        $players = $this->game->loadPlayersBasicInfos();
        $allReady = true;
        
        foreach ($players as $pId => $pInfo) {
            if (!$this->hasMulliganed($pId)) {
                $allReady = false;
                break;
            }
            $chars = $this->game->characterCards->getCardsInLocation('garden', $pId);
            if (count($chars) === 0) {
                $allReady = false;
                break;
            }
        }

        $playerId = (int)$this->game->getCurrentPlayerId();
        if ($allReady) {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, DistributeWeather::class);
        } else {
            // Only deactivate the current player if they have completed BOTH required actions
            $playerReady = $this->hasMulliganed($playerId) && count($this->game->characterCards->getCardsInLocation('garden', $playerId)) > 0;
            if ($playerReady) {
                $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
            }
        }
    }

    function zombie(int $playerId) {
        $this->game->DbQuery("UPDATE player SET player_mulligan_choice = 1 WHERE player_id = $playerId");
        // Auto-assign a random character to the zombie
        $chars = $this->game->characterCards->getCardsInLocation('garden', $playerId);
        if (count($chars) === 0) {
            $deck = $this->game->characterCards->getCardsInLocation('deck');
            if (count($deck) > 0) {
                $card = array_values($deck)[0];
                $this->game->characterCards->moveCard($card['id'], 'garden', $playerId);
            }
        }
        $this->game->gamestate->setPlayerNonMultiactive($playerId, DistributeWeather::class);
    }
}
