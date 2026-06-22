<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\OrigamePlantopia\Game;

class PlantingPhaseUpkeep extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 30,
            type: StateType::GAME,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        $players = $this->game->loadPlayersBasicInfos();



        foreach ($players as $pId => $pInfo) {
            $drawn = $this->game->plantCards->pickCards(1, 'deck', $pId);
            
            if (count($drawn) == 0) {
                // Deck is empty, reshuffle discard
                $this->game->plantCards->moveAllCardsInLocation('discard', 'deck');
                $this->game->plantCards->shuffle('deck');
                $this->bga->notify->all('message', clienttranslate('The plant deck is empty. Reshuffling the discard pile...'), []);
                
                $drawn = $this->game->plantCards->pickCards(1, 'deck', $pId);
            }

            // Notify player
            $this->bga->notify->player($pId, "cardsDrawn", '', [
                "cards" => $drawn
            ]);
            
            $this->bga->notify->all("playerDrewCard", clienttranslate('${player_name} drew 1 card.'), [
                "player_id" => $pId,
                "qty" => count($drawn),
            ]);
        }

        return PlantingPhase::class;
    }
}
