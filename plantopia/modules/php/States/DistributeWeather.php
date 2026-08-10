<?php

declare(strict_types=1);

namespace Bga\Games\Plantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\Plantopia\Game;

class DistributeWeather extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 13,
            type: StateType::GAME,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        $players = $this->game->loadPlayersBasicInfos();
        $charactersEnabled = $this->game->charactersEnabled();
        // Character types double as weather-card types (WeatherCards::
        // getDeckCards() keys each card's type to the matching character
        // name) — the ONLY source of playable Weather-phase cards, so a
        // no-character table still needs one per player. Shuffled ONCE
        // (not per player) and consumed in order below — there are exactly
        // 5 character types and this game supports at most 5 players (see
        // gameinfos.jsonc), so a per-player independent random pick could
        // (and in testing, did) collide: two players rolling the same type
        // means the second one finds that type's 3 cards already moved out
        // of the deck by the first, leaving them with an empty hand — the
        // exact bug this fix exists to prevent. Shuffling once and handing
        // out unique types in order guarantees no collision.
        $characterTypes = array_keys(Game::$CHARACTER_CARD_TYPES);
        shuffle($characterTypes);
        $nextTypeIndex = 0;

        foreach ($players as $pId => $pInfo) {
            if ($charactersEnabled) {
                $chars = $this->game->characterCards->getCardsInLocation('garden', $pId);
                if (count($chars) === 0) continue;
                $characterType = array_values($chars)[0]['type'];
            } else {
                // Characters disabled (Trello 95PCkqui): nobody ever claims
                // a character, but weather cards are only ever grouped by
                // character type, so without one nobody would have any
                // weather cards to play and the Weather phase would show no
                // buttons at all. Deal each player a distinct character's
                // weather cards directly — WITHOUT ever creating a
                // characterCards record for them. Deliberately not routed
                // through characterCards/garden: PlantingPhase's
                // getPlayerCharacter() (Carrot/Tomato effects, Banana
                // eligibility) and the player panel's character icon both
                // key off that same location, and none of those should be
                // active in a no-character game — only Game.charactersEnabled()
                // and SetupDecisions gate around a "no cards ever placed in
                // garden" invariant, so nothing here should break it.
                $characterType = $characterTypes[$nextTypeIndex % count($characterTypes)];
                $nextTypeIndex++;
                // Persist the assignment (Trello Lml0M7zY) — this is the
                // ONLY durable record of "which weather type does this
                // player have" for a disabled-character table, since
                // there's no character sitting in garden to re-derive it
                // from later. Without this, WeatherPhaseGrow's end-of-
                // round "return played card to hand" step had no way to
                // find the player's type on any round after this one, so
                // the cards never came back. See Game::getPlayerWeatherType().
                $this->game->DbQuery("UPDATE player SET player_random_weather_type = '$characterType' WHERE player_id = $pId");
            }

            // Find the 3 weather cards for this character
            $weatherDeck = $this->game->weatherCards->getCardsInLocation('deck');
            $cardsToMove = [];
            foreach ($weatherDeck as $wCard) {
                if ($wCard['type'] === $characterType) {
                    $cardsToMove[] = $wCard['id'];
                }
            }

            // Move the character weather cards to the player's hand.
            // NOTE: Mushroom's "1 Bonus Weather Card of each type" ability is
            // NOT granted here — it's already granted exactly once, at claim
            // time, in SetupDecisions::applyClaimAbility(). Granting it again
            // here (as this state previously did) doubled Mushroom's bonus
            // weather to 6 cards instead of 3. See https://trello.com/c/uiJWdVTg.
            $this->game->weatherCards->moveCards($cardsToMove, 'hand', $pId);

            // Send notification to the player
            $newHand = $this->game->weatherCards->getCardsInLocation('hand', $pId);
            $this->bga->notify->player($pId, "receivedWeatherCards", '', [
                "cards" => $newHand
            ]);

            $this->bga->notify->all("playerReceivedWeather", clienttranslate('${player_name} received their Character Weather cards.'), [
                "player_id" => $pId,
                "player_name" => $this->game->getPlayerNameById($pId),
            ]);
        }

        // Shuffle the remaining weather cards
        $this->game->weatherCards->shuffle('deck');

        return PlantingPhaseStart::class;
    }
}
