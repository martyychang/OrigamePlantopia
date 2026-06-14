<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\Games\OrigamePlantopia\Game;

class CharacterSelection extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 12,
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
    public function actClaimCharacter(int $cardId, int $activePlayerId)
    {
        // Ensure player doesn't already have a character
        $existing = $this->game->characterCards->getCardsInLocation('garden', $activePlayerId);
        if (count($existing) > 0) {
            throw new \Bga\GameFramework\UserException(clienttranslate("You have already claimed a character."));
        }

        $card = $this->game->characterCards->getCard($cardId);
        if ($card['location'] !== 'deck') {
            throw new \Bga\GameFramework\UserException(clienttranslate("This character has already been claimed."));
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
    public function actReturnCharacter(int $cardId, int $activePlayerId)
    {
        $card = $this->game->characterCards->getCard($cardId);
        if ($card['location'] !== 'garden' || (int)$card['location_arg'] !== $activePlayerId) {
            throw new \Bga\GameFramework\UserException(clienttranslate("You can only return a character you have claimed."));
        }

        $this->game->characterCards->moveCard($cardId, 'deck');

        $this->bga->notify->all("characterReturned", clienttranslate('${player_name} returned the ${character_name} character.'), [
            "player_id" => $activePlayerId,
            "card" => $this->game->characterCards->getCard($cardId),
            "character_name" => Game::$CHARACTER_CARD_TYPES[$card['type']]['name']
        ]);
    }

    private function checkIfAllPlayersReady()
    {
        $players = $this->game->loadPlayersBasicInfos();
        $allHaveCharacter = true;
        foreach ($players as $pId => $pInfo) {
            $chars = $this->game->characterCards->getCardsInLocation('garden', $pId);
            if (count($chars) === 0) {
                $allHaveCharacter = false;
                break;
            }
        }

        if ($allHaveCharacter) {
            foreach ($players as $pId => $pInfo) {
                $this->game->gamestate->setPlayerNonMultiactive($pId, DistributeWeather::class);
            }
        }
    }

    function zombie(int $playerId) {
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
