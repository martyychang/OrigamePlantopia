<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\OrigamePlantopia\Game;

class WeatherPhaseChoose extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 41,
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
    public function actChooseWeather(int $cardId)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();

        // Check card is in hand
        $card = $this->game->weatherCards->getCard($cardId);
        if ($card['location'] !== 'hand' || (int)$card['location_arg'] !== $playerId) {
            throw new UserException(clienttranslate("You do not have this card in your hand."));
        }

        // Check if already chosen
        $chosen = $this->game->weatherCards->getCardsInLocation('weather_chosen', $playerId);
        if (count($chosen) > 0) {
            throw new UserException(clienttranslate("You have already chosen a weather card."));
        }

        $this->game->weatherCards->moveCard($cardId, 'weather_chosen', $playerId);

        $this->bga->notify->player($playerId, "weatherChosen", '', [
            "card_id" => $cardId
        ]);
        
        $this->bga->notify->all("playerChosenWeather", clienttranslate('${player_name} has chosen a weather card.'), [
            "player_id" => $playerId,
        ]);

        $players = $this->game->loadPlayersBasicInfos();
        $allReady = true;
        foreach ($players as $pId => $pInfo) {
            $chosen = $this->game->weatherCards->getCardsInLocation('weather_chosen', $pId);
            if (count($chosen) === 0) {
                $allReady = false;
                break;
            }
        }

        if ($allReady) {
            foreach ($players as $pId => $pInfo) {
                $this->game->gamestate->setPlayerNonMultiactive($pId, WeatherPhaseReveal::class);
            }
        } else {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
        }
    }

    function zombie(int $playerId) {
        // Auto-choose a random weather card if zombie
        $cards = $this->game->weatherCards->getCardsInLocation('hand', $playerId);
        if (count($cards) > 0) {
            $card = array_values($cards)[0];
            $this->game->weatherCards->moveCard((int)$card['id'], 'weather_chosen', $playerId);
        }
        $players = $this->game->loadPlayersBasicInfos();
        $allReady = true;
        foreach ($players as $pId => $pInfo) {
            $chosen = $this->game->weatherCards->getCardsInLocation('weather_chosen', $pId);
            if (count($chosen) === 0) {
                $allReady = false;
                break;
            }
        }

        if ($allReady) {
            foreach ($players as $pId => $pInfo) {
                $this->game->gamestate->setPlayerNonMultiactive($pId, WeatherPhaseReveal::class);
            }
        } else {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
        }
    }
}
