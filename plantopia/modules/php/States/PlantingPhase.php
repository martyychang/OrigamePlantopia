<?php

declare(strict_types=1);

namespace Bga\Games\Plantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\PlantingPlayerSubstate;
use Bga\Games\Plantopia\WeatherCards;

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
            // ::from() throws if the DB ever holds a value this enum doesn't
            // define — fail fast instead of silently sending the client a
            // meaningless status number.
            $statuses[$pId] = PlantingPlayerSubstate::from((int)$this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $pId"))->value;
        }

        // Fresh, authoritative "your hand" — read synchronously as part of
        // entering this exact state, same "sync via getArgs() on state
        // entry, don't rely on notification timing" pattern used for
        // WeatherPhaseBonus/WeatherPhaseChoose (see
        // https://trello.com/c/61uLM9hR and "State Transitions & Frontend
        // Synchronization" in AGENTS.md). The narrowest of the three —
        // PlantingPhaseUpkeep (the immediately preceding state, one hop
        // away with no interactive state in between) is the only thing
        // that writes gamedatas.hand before this state's UI needs it — but
        // the theoretical race is the same shape, so it gets the same
        // treatment for consistency and defense in depth.
        //
        // hand is PRIVATE, so it must go through the `_private` mechanism
        // (keyed by the requesting player's id) rather than a top-level
        // key — returning it directly would leak every player's hand to
        // every other player. _merge_private flattens it into the
        // client's `args` object (args.hand) instead of
        // args._private.hand.
        $playerId = (int)$this->game->getCurrentPlayerId();
        return [
            'planting_statuses' => $statuses,
            '_private' => [
                $playerId => [
                    'hand' => $this->game->plantCards->getCardsInLocation('hand', $playerId),
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
    public function actPlant(int $cardId, int $planterCardId, string $paymentCardIds)
    {
        $paymentCardIds = $paymentCardIds === '' ? [] : array_map('intval', explode(';', $paymentCardIds));
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->requireReadyForNewAction($playerId);

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
            "payment_card_ids" => $paymentCardIds,
        ]);

        // Queue and execute "Lightning" effects
        if (isset($material['planting_effect'])) {
            $this->queueEffects($playerId, $material['planting_effect'], $cardId);
        } else {
            $this->game->DbQuery("UPDATE player SET player_pending_effects = '[]' WHERE player_id = $playerId");
        }

        // Phase 2 of https://trello.com/c/rgIS3JiZ: character abilities that
        // trigger at plant time. Carrot fires after planting an Adult
        // (treevolved) plant; Tomato fires after planting a Baby plant. Both
        // effects are queued *after* any built-in planting effects so the
        // built-in effect resolves first.
        $this->queueCharacterPlantingEffects($playerId, $card, $cardId);

        $this->processPendingEffects($playerId);
    }

    /**
     * Append character-driven effects to the player's pending-effects queue
     * based on the character they claimed during SetupDecisions and the
     * card they just planted.
     *
     * - Carrot: when an Adult Plant is planted, queue a grow-a-Baby effect.
     * - Tomato: when a Baby Plant is planted, queue a grow-a-matching-Adult
     *   effect (matching means same family — cactus/flower/tree).
     * - Skip if the player has no valid targets in their garden (no
     *   growable Baby for Carrot, no matching Adult below max level for
     *   Tomato), so the player isn't stuck on a no-op resolution.
     */
    private function queueCharacterPlantingEffects(int $playerId, array $plantedCard, int $sourceCardId): void
    {
        $character = $this->getPlayerCharacter($playerId);
        if ($character === null) {
            return;
        }

        $plantedType = $plantedCard['type'];

        if ($character === 'carrot' && PlantCards::isTreevolved($plantedType)) {
            if ($this->playerHasGrowableBaby($playerId)) {
                $this->appendEffect($playerId, [
                    'type'           => 'level_up',
                    'target'         => PlantCards::LEVEL_UP_BABY,
                    'qty'            => 1,
                    'source_card_id' => $sourceCardId,
                ]);
            }
            return;
        }

        if ($character === 'tomato' && PlantCards::isBaby($plantedType)) {
            $family = PlantCards::getFamily($plantedType);
            if ($this->playerHasGrowableAdultOfFamily($playerId, $family)) {
                $this->appendEffect($playerId, [
                    'type'           => 'level_up_matching_adult',
                    'family'         => $family,
                    'qty'            => 1,
                    'source_card_id' => $sourceCardId,
                ]);
            }
            return;
        }
    }

    /**
     * Returns the character type ('potato', 'mushroom', etc.) the player
     * claimed during SetupDecisions, or null if they have none.
     */
    private function getPlayerCharacter(int $playerId): ?string
    {
        $chars = $this->game->characterCards->getCardsInLocation('garden', $playerId);
        if (empty($chars)) {
            return null;
        }
        $card = array_values($chars)[0];
        return $card['type'];
    }

    /**
     * Append a single effect onto the player's pending-effects queue,
     * preserving any effects already queued ahead of it.
     */
    private function appendEffect(int $playerId, array $effect): void
    {
        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        $queue[] = $effect;
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
    }

    /**
     * True if the player has at least one Baby Plant in a planter below
     * the maximum level (i.e., growable by 1 level).
     */
    private function playerHasGrowableBaby(int $playerId): bool
    {
        $rows = $this->game->getCollectionFromDb("
            SELECT pc.card_id, pc.card_type, pc.card_type_arg
            FROM plant_card pc
            JOIN planter_card plc ON plc.card_id = pc.card_location_arg
            WHERE pc.card_location = 'planter'
              AND plc.card_location_arg = $playerId
        ");
        foreach ($rows as $row) {
            if (PlantCards::isBaby($row['card_type']) && (int)$row['card_type_arg'] < 3) {
                return true;
            }
        }
        return false;
    }

    /**
     * True if the player has at least one Plant of any family in a planter
     * below max level. Used to decide whether 'level_up_family' is moot.
     */
    private function playerHasGrowablePlant(int $playerId): bool
    {
        $rows = $this->game->getCollectionFromDb("
            SELECT pc.card_type_arg
            FROM plant_card pc
            JOIN planter_card plc ON plc.card_id = pc.card_location_arg
            WHERE pc.card_location = 'planter'
              AND plc.card_location_arg = $playerId
        ");
        foreach ($rows as $row) {
            if ((int)$row['card_type_arg'] < 3) {
                return true;
            }
        }
        return false;
    }

    /**
     * True if the player has at least one Plant on a planter, below max
     * level, that satisfies the level_up effect's target restriction.
     *
     *  - LEVEL_UP_ANY:   any growable plant
     *  - LEVEL_UP_OTHER: any growable plant other than $sourceCardId
     *  - LEVEL_UP_BABY:  any growable Baby plant
     *
     * (LEVEL_UP_THIS is auto-resolved and never reaches this check.)
     */
    private function playerHasLevelUpTarget(int $playerId, string $target, ?int $sourceCardId): bool
    {
        $rows = $this->game->getCollectionFromDb("
            SELECT pc.card_id, pc.card_type, pc.card_type_arg
            FROM plant_card pc
            JOIN planter_card plc ON plc.card_id = pc.card_location_arg
            WHERE pc.card_location = 'planter'
              AND plc.card_location_arg = $playerId
        ");
        foreach ($rows as $row) {
            if ((int)$row['card_type_arg'] >= 3) continue;
            if ($target === PlantCards::LEVEL_UP_OTHER && (int)$row['card_id'] === (int)$sourceCardId) continue;
            if ($target === PlantCards::LEVEL_UP_BABY && !PlantCards::isBaby($row['card_type'])) continue;
            return true;
        }
        return false;
    }

    /**
     * True if the pending interactive effect has no valid resolution in
     * the current state (e.g., a level_up with no plant to target, a
     * gain_weather with both the typed pool and the entire bonus market
     * empty). Effects flagged moot are popped silently by
     * processPendingEffects so the player isn't trapped on a prompt they
     * cannot fulfill. See https://trello.com/c/qcAmX7KC.
     */
    private function isInteractiveEffectMoot(int $playerId, array $effect): bool
    {
        switch ($effect['type']) {
            case 'level_up':
                if ($effect['target'] === PlantCards::LEVEL_UP_THIS) return false;
                return !$this->playerHasLevelUpTarget(
                    $playerId,
                    $effect['target'],
                    $effect['source_card_id'] ?? null
                );

            case 'level_up_family':
                return !$this->playerHasGrowablePlant($playerId);

            case 'level_up_matching_adult':
                return !$this->playerHasGrowableAdultOfFamily($playerId, $effect['family']);

            case 'gain_weather':
                $type = $effect['weather_type'];
                if ($type !== PlantCards::WEATHER_ANY) {
                    $typed = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', $this->weatherCondition($type), 'bonus_deck');
                    if (count($typed) > 0) return false;
                }
                $market = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', null, 'bonus_deck');
                return count($market) === 0;

            case 'discard_cards':
                return $this->game->plantCards->countCardInLocation('hand', $playerId) === 0;

            default:
                // draft_cards, draw_cards, gain_action, banana_offer — never moot
                // by their nature (banana is pre-gated by isBananaEligible).
                return false;
        }
    }

    /**
     * Map a PlantCards::WEATHER_* string (sun/rain/wind) to the
     * WeatherCards::CONDITION_* int used as a bonus weather card's
     * type_arg. These are two independently-defined constants for the
     * same three conditions — passing the PlantCards string straight into
     * getCardsOfTypeInLocation() (which matches on type_arg) silently
     * matched zero cards for every planting effect that gains a SPECIFIC
     * weather type (e.g. Treegonometree's "gain a Bonus Rain card"),
     * making the effect fall through to the generic "choose any weather
     * card" prompt instead of auto-granting the intended one. See
     * https://trello.com/c/xGkeMcXO. Not called for PlantCards::WEATHER_ANY,
     * which has no matching CONDITION_* and is handled separately by every
     * caller.
     */
    private function weatherCondition(string $plantCardsWeatherType): int
    {
        return match ($plantCardsWeatherType) {
            PlantCards::WEATHER_SUN => WeatherCards::CONDITION_SUN,
            PlantCards::WEATHER_RAIN => WeatherCards::CONDITION_RAIN,
            PlantCards::WEATHER_WIND => WeatherCards::CONDITION_WIND,
        };
    }

    /**
     * True if the player can skip the given pending effect via the
     * client-side "Skip" button. Forced/penalty effects (discard_cards)
     * are not skippable; choice effects are.
     */
    private function isEffectSkippable(array $effect): bool
    {
        return in_array($effect['type'], [
            'level_up',
            'level_up_family',
            'level_up_matching_adult',
            'gain_weather',
        ], true);
    }

    /**
     * True if the player has at least one Adult (Treevolved) Plant of the
     * given family in a planter below max level (i.e., growable).
     */
    private function playerHasGrowableAdultOfFamily(int $playerId, string $family): bool
    {
        $rows = $this->game->getCollectionFromDb("
            SELECT pc.card_id, pc.card_type, pc.card_type_arg
            FROM plant_card pc
            JOIN planter_card plc ON plc.card_id = pc.card_location_arg
            WHERE pc.card_location = 'planter'
              AND plc.card_location_arg = $playerId
        ");
        foreach ($rows as $row) {
            $type = $row['card_type'];
            if (PlantCards::isTreevolved($type)
                && PlantCards::getFamily($type) === $family
                && (int)$row['card_type_arg'] < 3) {
                return true;
            }
        }
        return false;
    }

    #[PossibleAction]
    public function actGrow(int $plantCardId, string $paymentCardIds)
    {
        $paymentCardIds = $paymentCardIds === '' ? [] : array_map('intval', explode(';', $paymentCardIds));
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->requireReadyForNewAction($playerId);

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
        $this->requireReadyForNewAction($playerId);

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
                throw new UserException(clienttranslate("You must choose exactly {$keepQty} card(s)."));
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
        // gain_weather_types (plural) is for a card that grants several
        // DIFFERENT specific types in one effect (e.g. Gum Tree: a Bonus
        // Rain Card AND a Bonus Sun Card) — one queue entry per type, each
        // auto-resolved with no player choice by the gain_weather branch
        // of processPendingEffects() below (which only auto-resolves a
        // SPECIFIC weather_type, never WEATHER_ANY). See
        // https://trello.com/c/L56GTT7Q.
        if (isset($effectDef['gain_weather_types'])) {
            foreach ($effectDef['gain_weather_types'] as $weatherType) {
                $queue[] = ['type' => 'gain_weather', 'weather_type' => $weatherType, 'qty' => 1];
            }
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
                $this->bga->notify->all("playerDrewCard", clienttranslate('${player_name} drew cards from planting effect.'), ["player_id" => $playerId, "qty" => count($drawn)]);
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
                // A typed gain_weather effect (e.g. Treegonometree: "gain a
                // Bonus Rain Card") grants ONLY that specific weather type —
                // unlike Geometree's "gain any Bonus Weather Card" (queued
                // with WEATHER_ANY from the start, handled by the
                // isInteractiveEffectMoot branch below), there is no player
                // choice and no fallback to a different type if the typed
                // pool is empty. This used to downgrade to WEATHER_ANY and
                // present an interactive "choose any weather card" prompt
                // whenever the OVERALL market was non-empty — silently
                // handing out a different type than the card promises, and
                // when the whole market WAS empty too, silently dropping
                // the effect with no notification at all, leaving the
                // player's client stuck showing the last-rendered prompt.
                // See https://trello.com/c/ngnBJhnS.
                $cards = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', $this->weatherCondition($effect['weather_type']), 'bonus_deck');
                if (count($cards) > 0) {
                    $card = array_values($cards)[0];
                    // Bonus weather cards live publicly in 'weather_public_bonus'
                    // (per https://trello.com/c/B5g3UmED — held visibly per player
                    // until played, returned to the supply when played). Was 'hand'
                    // pre-refactor.
                    $this->game->weatherCards->moveCard($card['id'], 'weather_public_bonus', $playerId);
                    $card = $this->game->weatherCards->getCard($card['id']);
                    $this->bga->notify->player($playerId, "weatherCardsDrawn", '', ["cards" => [$card]]);
                    // The market just lost this card — broadcast the updated
                    // count so every client's market display stays in sync.
                    // See https://trello.com/c/uiJWdVTg.
                    $bonusMarket = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', null, 'bonus_deck');
                    $this->bga->notify->all("playerGainedWeather", clienttranslate('${player_name} gained a Bonus ${weather_name} Card.'), [
                        "player_id" => $playerId,
                        "weather_name" => ucfirst($effect['weather_type']),
                        "card" => $card, // bonus weather card is publicly held — broadcast it
                        "bonusMarket" => $bonusMarket,
                    ]);
                } else {
                    $this->bga->notify->all("message", clienttranslate('${player_name} could not gain a Bonus ${weather_name} Card — none remain.'), [
                        "player_id" => $playerId,
                        "player_name" => $this->game->getPlayerNameById($playerId),
                        "weather_name" => ucfirst($effect['weather_type']),
                    ]);
                }
                array_shift($queue);
            }
            else {
                // Normally an interactive effect — but if it has no valid
                // resolution in the current state (e.g., a level_up with no
                // plant to target), silently pop it instead of trapping the
                // player on an unfulfillable prompt. See
                // https://trello.com/c/qcAmX7KC.
                if ($this->isInteractiveEffectMoot($playerId, $effect)) {
                    $this->bga->notify->all("message", clienttranslate('${player_name} skipped the ${effect_name} effect (no valid target).'), [
                        "player_id" => $playerId,
                        "player_name" => $this->game->getPlayerNameById($playerId),
                        "effect_name" => $effect['type'],
                    ]);
                    array_shift($queue);
                    continue;
                }
                break;
            }
        }
        
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        
        if (count($queue) > 0) {
            $this->game->DbQuery("UPDATE player SET player_planting_status = " . PlantingPlayerSubstate::ResolvingEffects->value . " WHERE player_id = $playerId");
            $this->bga->notify->player($playerId, "pendingEffects", '', [
                "effects" => $queue
            ]);
            $this->bga->notify->all("playerResolvingEffects", clienttranslate('${player_name} is resolving plant effects.'), [
                "player_id" => $playerId,
            ]);
        } else {
            $status = $this->substateOf($playerId);
            if (!$gainedAction && $status !== PlantingPlayerSubstate::Done) {
                $this->tryMarkPlayerDone($playerId);
            } else if ($gainedAction) {
                $this->game->DbQuery("UPDATE player SET player_planting_status = " . PlantingPlayerSubstate::Ready->value . " WHERE player_id = $playerId");
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
                throw new UserException(clienttranslate("You must discard exactly {$qty} cards."));
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

        // Bonus weather is held publicly per player (https://trello.com/c/B5g3UmED).
        $this->game->weatherCards->moveCard($cardId, 'weather_public_bonus', $playerId);
        $card = $this->game->weatherCards->getCard($cardId);
        $this->bga->notify->player($playerId, "weatherCardsDrawn", '', ["cards" => [$card]]);
        // The market just lost this card — broadcast the updated count. See
        // https://trello.com/c/uiJWdVTg.
        $bonusMarket = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', null, 'bonus_deck');
        $this->bga->notify->all("playerGainedWeather", clienttranslate('${player_name} gained a Bonus Weather Card.'), [
            "player_id" => $playerId,
            "card" => $card,
            "bonusMarket" => $bonusMarket,
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
        // Note: 'level_up_family' (Violet) is resolved by the separate
        // actResolveLevelUpFamily($family) action below, which grows every
        // matching plant rather than one $plantCardId — it must NOT be
        // accepted here, or a client that called this action instead would
        // silently grow only one plant and pop the effect as if it had
        // resolved the whole family.
        if (count($queue) === 0 || $queue[0]['type'] !== 'level_up') {
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

        if ($effect['target'] === PlantCards::LEVEL_UP_OTHER && $plantCardId === $effect['source_card_id']) {
            throw new UserException(clienttranslate("You must select a different plant to grow."));
        }
        if ($effect['target'] === PlantCards::LEVEL_UP_BABY && !PlantCards::isBaby($plant['type'])) {
            throw new UserException(clienttranslate("You must select a Baby plant to grow."));
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

    /**
     * Resolve the Tomato character's plant-time effect: grow one Adult
     * (Treevolved) Plant matching the family of the Baby that was just
     * planted. The player chooses which matching Adult to grow when
     * multiple eligible targets exist.
     */
    #[PossibleAction]
    public function actResolveLevelUpMatchingAdult(int $plantCardId)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || $queue[0]['type'] !== 'level_up_matching_adult') {
            throw new UserException(clienttranslate("You do not have a matching-Adult level up effect to resolve."));
        }
        $effect = $queue[0];

        $plant = $this->game->plantCards->getCard($plantCardId);
        if ($plant['location'] !== 'planter') {
            throw new UserException(clienttranslate("You can only grow plants that are on a planter."));
        }
        $pId = $this->game->getUniqueValueFromDb("SELECT card_location_arg FROM planter_card WHERE card_id = " . $plant['location_arg']);
        if ((int)$pId !== $playerId) {
            throw new UserException(clienttranslate("This plant is not in your garden."));
        }
        if (!PlantCards::isTreevolved($plant['type'])) {
            throw new UserException(clienttranslate("You must select an Adult (Treevolved) plant to grow."));
        }
        if (PlantCards::getFamily($plant['type']) !== $effect['family']) {
            throw new UserException(clienttranslate("You must select an Adult plant of the matching family."));
        }
        $level = (int)$plant['type_arg'];
        if ($level >= 3) {
            throw new UserException(clienttranslate("This plant is already at maximum level."));
        }

        $newLevel = min(3, $level + $effect['qty']);
        $this->game->DbQuery("UPDATE plant_card SET card_type_arg = $newLevel WHERE card_id = $plantCardId");
        if ($newLevel === 3) {
            $this->game->plantCards->moveCard($plantCardId, 'garden_level3', $playerId);
        }

        $material = Game::$PLANT_CARD_TYPES[$plant['type']];
        $this->bga->notify->all("plantGrown", clienttranslate('${player_name} grew their ${plant_name} to level ${level} (Tomato ability).'), [
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

    /**
     * Guard for the "resolve a pending effect" actions (actResolveLevelUp,
     * actResolveGainWeather, actResolveDiscard, actResolveLevelUpFamily,
     * actResolveLevelUpMatchingAdult, actSkipPendingEffect): rejects only a
     * player who has already fully finished their turn. Deliberately does
     * NOT reject ResolvingEffects — these actions are exactly how a player
     * gets OUT of that substate, and each one independently validates the
     * front of player_pending_effects matches what it expects, so a
     * Ready player (empty queue) is already caught by that check with a
     * more specific error message.
     */
    private function checkActionAllowed(int $playerId)
    {
        $status = $this->substateOf($playerId);
        if ($status === PlantingPlayerSubstate::Done) {
            throw new UserException(clienttranslate("You have already performed your planting action."));
        }
    }

    /**
     * Guard for the "start a brand-new top-level action" actions (actPlant,
     * actGrow, actRequestDraw5): rejects unless the player's substate is
     * exactly Ready. This is stricter than checkActionAllowed() on purpose
     * — it also rejects ResolvingEffects, closing a real bug found while
     * documenting this pattern: without this, a player could start a
     * second planting action while their first one's interactive effect
     * (e.g. an unresolved level_up choice) was still pending, silently
     * appending the new card's effects onto the same queue as the
     * unresolved one. See "Player substates — pattern & rules" in the BGA
     * Studio State Machine doc.
     */
    private function requireReadyForNewAction(int $playerId): void
    {
        if ($this->substateOf($playerId) !== PlantingPlayerSubstate::Ready) {
            throw new UserException(clienttranslate("You must resolve your pending effect before taking another action."));
        }
    }

    private function substateOf(int $playerId): PlantingPlayerSubstate
    {
        return PlantingPlayerSubstate::from((int)$this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $playerId"));
    }

    /**
     * The ONLY method allowed to call setPlayerNonMultiactive() for this
     * state — every code path that concludes a player's Planting Phase
     * turn (actGrow, actDeclineBananaAbility, the zombie/AFK handler, and
     * processPendingEffects once the effect queue drains with no gained
     * action) funnels through here rather than calling the framework
     * directly, so there's exactly one place this transition can go wrong.
     */
    private function markPlayerDone(int $playerId)
    {
        $this->game->DbQuery("UPDATE player SET player_planting_status = " . PlantingPlayerSubstate::Done->value . " WHERE player_id = $playerId");
        $this->game->gamestate->setPlayerNonMultiactive($playerId, WeatherPhaseStart::class);
    }

    /**
     * Phase 3 of https://trello.com/c/rgIS3JiZ — Banana character ability.
     *
     * Called when the player has finished their normal Planting Phase action
     * and would otherwise be marked done. If the Banana ability is eligible
     * (player claimed Banana, hasn't used it this round, and has at least
     * 2 Baby Plant cards in hand), instead of marking done we queue a
     * 'banana_offer' effect, set status to 'resolving_effects', and notify
     * the player so the client can present Use/Skip buttons. Otherwise we
     * delegate to markPlayerDone as before.
     */
    private function tryMarkPlayerDone(int $playerId): void
    {
        if (!$this->isBananaEligible($playerId)) {
            $this->markPlayerDone($playerId);
            return;
        }

        $this->appendEffect($playerId, ['type' => 'banana_offer']);
        $this->game->DbQuery("UPDATE player SET player_planting_status = " . PlantingPlayerSubstate::ResolvingEffects->value . " WHERE player_id = $playerId");

        $queue = json_decode(
            $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId") ?: '[]',
            true
        );
        $this->bga->notify->player($playerId, "pendingEffects", '', [
            "effects" => $queue
        ]);
        $this->bga->notify->all("playerResolvingEffects", clienttranslate('${player_name} is deciding whether to use the Banana ability.'), [
            "player_id" => $playerId,
        ]);
    }

    /**
     * True iff the player can currently use the Banana ability:
     *   - their claimed character is Banana
     *   - they have not yet used the ability this Planting Phase
     *   - they have at least 2 Baby Plant cards in their hand
     */
    private function isBananaEligible(int $playerId): bool
    {
        if ($this->getPlayerCharacter($playerId) !== 'banana') {
            return false;
        }
        $used = (int)$this->game->getUniqueValueFromDb("SELECT player_banana_used FROM player WHERE player_id = $playerId");
        if ($used !== 0) {
            return false;
        }
        return count($this->getBabyCardsInHand($playerId)) >= 2;
    }

    /**
     * Return the Baby Plant cards in the player's hand, as an array keyed by
     * card id. Used by the Banana eligibility check and the resolve handler.
     */
    private function getBabyCardsInHand(int $playerId): array
    {
        $hand = $this->game->plantCards->getCardsInLocation('hand', $playerId);
        $babies = [];
        foreach ($hand as $cardId => $card) {
            if (PlantCards::isBaby($card['type'])) {
                $babies[$cardId] = $card;
            }
        }
        return $babies;
    }

    /**
     * Player chose to use the Banana ability: discard exactly 2 Baby Plant
     * cards from their hand, mark the ability used for this round, and reset
     * their planting status so they take one more Planting Phase action.
     */
    #[PossibleAction]
    public function actUseBananaAbility(string $babyCardIdsStr)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || $queue[0]['type'] !== 'banana_offer') {
            throw new UserException(clienttranslate("There is no Banana offer to resolve."));
        }
        if ($this->getPlayerCharacter($playerId) !== 'banana') {
            throw new UserException(clienttranslate("Only the Banana character can use this ability."));
        }
        $used = (int)$this->game->getUniqueValueFromDb("SELECT player_banana_used FROM player WHERE player_id = $playerId");
        if ($used !== 0) {
            throw new UserException(clienttranslate("You have already used the Banana ability this round."));
        }

        $cardIds = $babyCardIdsStr === '' ? [] : array_map('intval', explode(';', $babyCardIdsStr));
        if (count($cardIds) !== 2) {
            throw new UserException(clienttranslate("You must discard exactly 2 Baby Plant cards."));
        }
        foreach ($cardIds as $cId) {
            $card = $this->game->plantCards->getCard($cId);
            if ($card['location'] !== 'hand' || (int)$card['location_arg'] !== $playerId) {
                throw new UserException(clienttranslate("You can only discard cards from your hand."));
            }
            if (!PlantCards::isBaby($card['type'])) {
                throw new UserException(clienttranslate("You must discard Baby Plant cards only."));
            }
        }

        $this->game->plantCards->moveCards($cardIds, 'discard');

        // Mark Banana used for the rest of this Planting Phase, then
        // reset planting status so the player gains a new action and
        // pop the banana_offer off the queue.
        $this->game->DbQuery("UPDATE player SET player_banana_used = 1, player_planting_status = " . PlantingPlayerSubstate::Ready->value . " WHERE player_id = $playerId");
        array_shift($queue);
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");

        // Cast to int — see https://trello.com/c/vjsQX06a: the client does
        // numeric += on these across notifications, and a raw numeric-string
        // count from the Deck component poisons every later update into
        // string concatenation.
        $handCounts = array_map('intval', $this->game->plantCards->countCardsByLocationArgs('hand'));
        $this->bga->notify->player($playerId, "newHand", '', [
            "cards" => $this->game->plantCards->getCardsInLocation('hand', $playerId),
        ]);
        $this->bga->notify->all("playerUsedBananaAbility", clienttranslate('${player_name} discarded 2 Baby Plants and gained an extra Planting Phase action (Banana ability).'), [
            "player_id" => $playerId,
            "handCounts" => $handCounts,
        ]);
        // Mirror the gain_action notification so the player's client resets
        // status to 0, clears the banana_offer from pending_effects, and
        // re-renders the planting action buttons.
        $this->bga->notify->all("playerGainedAction", clienttranslate('${player_name} immediately takes another Planting Phase action.'), [
            "player_id" => $playerId,
            "player_name" => $this->game->getPlayerNameById($playerId),
        ]);
    }

    /**
     * Player chose NOT to use the Banana ability this round: pop the
     * banana_offer from the queue and finish their Planting Phase.
     */
    #[PossibleAction]
    public function actDeclineBananaAbility()
    {
        $playerId = (int)$this->game->getCurrentPlayerId();

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0 || $queue[0]['type'] !== 'banana_offer') {
            throw new UserException(clienttranslate("There is no Banana offer to resolve."));
        }

        array_shift($queue);
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        $this->markPlayerDone($playerId);
    }

    /**
     * Skip the current pending interactive effect. Used by the "Skip"
     * button surfaced on level_up / level_up_family / level_up_matching_adult
     * / gain_weather prompts. Forced effects (discard_cards) are not
     * skippable. See https://trello.com/c/qcAmX7KC.
     */
    #[PossibleAction]
    public function actSkipPendingEffect()
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->checkActionAllowed($playerId);

        $currentJson = $this->game->getUniqueValueFromDb("SELECT player_pending_effects FROM player WHERE player_id = $playerId");
        $queue = $currentJson ? json_decode($currentJson, true) : [];
        if (count($queue) === 0) {
            throw new UserException(clienttranslate("There is no pending effect to skip."));
        }
        $effect = $queue[0];
        if (!$this->isEffectSkippable($effect)) {
            throw new UserException(clienttranslate("This effect cannot be skipped."));
        }

        $this->bga->notify->all("message", clienttranslate('${player_name} skipped the ${effect_name} effect.'), [
            "player_id" => $playerId,
            "player_name" => $this->game->getPlayerNameById($playerId),
            "effect_name" => $effect['type'],
        ]);

        array_shift($queue);
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '" . json_encode($queue) . "' WHERE player_id = $playerId");
        $this->processPendingEffects($playerId);
    }

    function zombie(int $playerId) {
        $this->game->DbQuery("UPDATE player SET player_pending_effects = '[]' WHERE player_id = $playerId");
        $this->markPlayerDone($playerId);
    }
}
