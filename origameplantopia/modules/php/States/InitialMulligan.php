<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\Games\OrigamePlantopia\Game;

class InitialMulligan extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 11,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
        );
    }

    public function getArgs(): array
    {
        return [];
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->bga->gamestate->setAllPlayersMultiactive();
    }

    #[PossibleAction]
    public function actKeep(int $activePlayerId)
    {
        // Player chooses to keep their starting hand.
        $this->bga->notify->all("playerKeptCards", clienttranslate('${player_name} kept their starting hand.'), [
            "player_id" => $activePlayerId,
        ]);

        $this->bga->gamestate->setPlayerNonMultiactive($activePlayerId, NextPlayer::class);
    }

    #[PossibleAction]
    public function actRedraw(int $activePlayerId)
    {
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

        $this->bga->gamestate->setPlayerNonMultiactive($activePlayerId, NextPlayer::class);
    }

    function zombie(int $playerId) {
        $this->actKeep($playerId);
    }
}
