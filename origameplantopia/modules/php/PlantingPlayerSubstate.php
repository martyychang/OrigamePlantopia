<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia;

/**
 * Per-player substate within the Planting Phase state family (PlantingPhase
 * / PlantingPhaseUpkeep / PlantingPhaseStart). Each active player runs
 * their own independent substate machine while the shared GameState stays
 * put; PlantingPhase only advances once every player's substate has
 * reached Done. See "Player substates — pattern & rules" in the BGA
 * Studio State Machine doc for the full model this implements.
 *
 * Persisted as the player.player_planting_status DB column (a plain int
 * matching this enum's backing values) — that column is the ONLY source
 * of truth. Never reconstruct a player's substate from notifications;
 * every notification-driven bug found in this game so far was a client
 * tracking a derived value instead of reading the authoritative one.
 *
 * Note the backing values are 0, 1, 3 — not 0, 1, 2. A status value of 2
 * existed only as a dead check in the pre-enum code (never actually set
 * anywhere); left out here rather than assigned a meaning it never had.
 *
 * Deliberately lives in modules/php/, NOT modules/php/States/ — BGA
 * Studio's game-creation bootstrap scans every class under States/ and
 * fatals if it doesn't extend GameState (found via a live Express Start
 * failure — https://trello.com/c/NuwHfekb). PlantCards/WeatherCards/
 * CharacterCards already draw this same line between "material/data
 * type" and "state machine class"; this enum is the same kind of thing
 * they are, not a GameState.
 */
enum PlantingPlayerSubstate: int
{
    /** Eligible to take a new Planting Phase action (actPlant / actGrow / actRequestDraw5). */
    case Ready = 0;

    /** Finished this Planting Phase; non-active until WeatherPhaseStart. */
    case Done = 1;

    /**
     * Mid-resolution of a queued effect chain (an interactive prompt like
     * level_up/gain_weather, or a banana_offer decision). No new Planting
     * Phase action may start until this resolves — see
     * PlantingPhase::requireReadyForNewAction().
     */
    case ResolvingEffects = 3;
}
