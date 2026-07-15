<?php

declare(strict_types=1);

namespace Bga\Games\Plantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\Plantopia\Game;

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
        // Fresh, authoritative "your hand of character weather cards" —
        // read synchronously as part of entering this exact state, the
        // same "sync via getArgs() on state entry, don't rely on
        // notification timing" pattern used for WeatherPhaseBonus (see
        // https://trello.com/c/61uLM9hR and "State Transitions & Frontend
        // Synchronization" in AGENTS.md). This state's UI (one button per
        // held character weather card) previously depended entirely on
        // gamedatas.weatherHand having already been populated by the
        // receivedWeatherCards notification fired by WeatherPhaseGrow, a
        // full interactive PlantingPhase round earlier — the same shape of
        // risk that broke WeatherPhaseBonus, just with a longer (and so
        // less likely, but not impossible) gap before it matters.
        //
        // weatherHand is PRIVATE (each player's own hand), so it must go
        // through the `_private` mechanism (keyed by the requesting
        // player's id) rather than the top-level array WeatherPhaseBonus
        // uses for its PUBLIC weather_public_bonus data — returning it
        // directly would leak every player's hand to every other player.
        // _merge_private flattens it into the client's `args` object
        // (args.weatherHand) instead of args._private.weatherHand, so it
        // reads identically to the public-data case on the JS side.
        $playerId = (int)$this->game->getCurrentPlayerId();
        return [
            '_private' => [
                $playerId => [
                    'weatherHand' => $this->game->weatherCards->getCardsInLocation('hand', $playerId),
                ],
            ],
            '_merge_private' => true,
        ];
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->game->gamestate->setAllPlayersMultiactive();
        $this->game->giveExtraTimeToAllPlayers();
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

        if ($card['type'] === 'bonus') {
            throw new UserException(clienttranslate("You cannot choose a bonus weather card as your primary weather."));
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
            $this->game->gamestate->setPlayerNonMultiactive($playerId, WeatherPhaseReveal::class);
        } else {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
        }
    }

    function zombie(int $playerId) {
        // Zombie mode Level 0 ("The Passing Zombie" — see
        // https://en.doc.boardgamearena.com/Zombie_Mode): choose the
        // first available weather card, not an actually-random one. This
        // used to be commented as "random" — it isn't, array_values()[0]
        // is a deterministic pick, not a random draw. See
        // https://trello.com/c/5yFNTibV.
        $cards = $this->game->weatherCards->getCardsInLocation('hand', $playerId);
        $characterCards = array_filter($cards, fn($c) => $c['type'] !== 'bonus');
        if (count($characterCards) > 0) {
            $card = array_values($characterCards)[0];
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
            $this->game->gamestate->setPlayerNonMultiactive($playerId, WeatherPhaseReveal::class);
        } else {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
        }
    }
}
