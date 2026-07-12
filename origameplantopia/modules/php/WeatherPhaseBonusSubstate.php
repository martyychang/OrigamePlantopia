<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia;

/**
 * Per-player substate within WeatherPhaseBonus. Each active player
 * independently plays Bonus Weather cards or passes; the shared state
 * only advances once every player has reached Passed. See "Player
 * substates — pattern & rules" in the BGA Studio State Machine doc.
 *
 * Persisted as the player.player_bonus_weather_status DB column — that
 * column is the ONLY source of truth. Deliberately a separate column
 * (and separate enum) from PlantingPlayerSubstate: "finished planting"
 * and "passed on playing more Bonus Weather" are unrelated facts about
 * the game that only happen to share the same readiness-gate SHAPE, not
 * the same meaning. Sharing one column across both would couple two
 * state families that have no reason to know about each other.
 *
 * Deliberately lives in modules/php/, NOT modules/php/States/ — BGA
 * Studio's game-creation bootstrap scans every class under States/ and
 * fatals if it doesn't extend GameState (found via a live Express Start
 * failure — https://trello.com/c/NuwHfekb). PlantCards/WeatherCards/
 * CharacterCards already draw this same line between "material/data
 * type" and "state machine class"; this enum is the same kind of thing
 * they are, not a GameState.
 */
enum WeatherPhaseBonusSubstate: int
{
    /** Still deciding whether to play more Bonus Weather cards this round. */
    case Deciding = 0;

    /** Passed (voluntarily, or forced by actPlayBonusWeather / zombie). */
    case Passed = 1;
}
