<?php
declare(strict_types=1);

/**
 * Systematic audit requested by Marty: go card-by-card and verify each
 * card's effect is *actually* implemented, not just described in text.
 *
 * This is the "shape" half of that audit: PlantingPhase::queueEffects()
 * only recognizes a fixed set of planting_effect keys (draw_cards,
 * draft_cards+keep_cards, discard_cards, gain_weather_qty+gain_weather_type,
 * gain_weather_types, level_up+level_up_qty, level_up_family, gain_action).
 * Any card whose planting_effect uses a key outside that set would have
 * that part of its effect SILENTLY DROPPED — queueEffects only reads keys
 * it recognizes, it never errors on ones it doesn't. This exact class of
 * bug (a recognized-looking field that the engine doesn't actually wire
 * up) is what made https://trello.com/c/xGkeMcXO possible — this test
 * generalizes that check to all 33 plant cards instead of relying on
 * someone noticing one broken card in play-testing.
 *
 * Companion to BonusScoringKeysTest.php (same idea, for bonus_scoring).
 *
 * Run: php tests/php/PlantingEffectKeysTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';

use Bga\Games\OrigamePlantopia\PlantCards;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    if ($cond) {
        echo "  ok  — $label\n";
    } else {
        echo "  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n";
        $failures++;
    }
}

// Every key queueEffects() actually reads, plus their companion params.
// See PlantingPhase::queueEffects().
const RECOGNIZED_PLANTING_EFFECT_KEYS = [
    'draw_cards',
    'draft_cards', 'keep_cards',
    'discard_cards',
    'gain_weather_qty', 'gain_weather_type',
    'gain_weather_types',
    'level_up', 'level_up_qty',
    'level_up_family',
    'gain_action',
];

// gain_weather_type values PlantingPhase::weatherCondition() can map to a
// real WeatherCards::CONDITION_* — anything else silently breaks the same
// way https://trello.com/c/xGkeMcXO did.
const RECOGNIZED_WEATHER_TYPES = [
    PlantCards::WEATHER_SUN, PlantCards::WEATHER_RAIN, PlantCards::WEATHER_WIND, PlantCards::WEATHER_ANY,
];

// level_up target values PlantingPhase actually branches on.
const RECOGNIZED_LEVEL_UP_TARGETS = [
    PlantCards::LEVEL_UP_ANY, PlantCards::LEVEL_UP_OTHER, PlantCards::LEVEL_UP_THIS, PlantCards::LEVEL_UP_BABY,
];

$types = PlantCards::getTypes();
check('PlantCards::getTypes() returns a non-empty catalog', count($types) > 0, 'count=' . count($types));

foreach ($types as $name => $info) {
    $effect = $info['planting_effect'] ?? [];
    if (empty($effect)) continue;

    $unknownKeys = array_diff(array_keys($effect), RECOGNIZED_PLANTING_EFFECT_KEYS);
    check("$name: planting_effect has no unrecognized keys", empty($unknownKeys), 'unknown=' . json_encode($unknownKeys));

    if (isset($effect['draft_cards'])) {
        check("$name: draft_cards is paired with keep_cards", isset($effect['keep_cards']));
    }

    if (isset($effect['gain_weather_type'])) {
        check(
            "$name: gain_weather_type is a recognized weather constant",
            in_array($effect['gain_weather_type'], RECOGNIZED_WEATHER_TYPES, true),
            'value=' . json_encode($effect['gain_weather_type'])
        );
    }

    if (isset($effect['gain_weather_types'])) {
        check(
            "$name: gain_weather_types is a non-empty array",
            is_array($effect['gain_weather_types']) && count($effect['gain_weather_types']) > 0
        );
        $unrecognizedTypes = array_diff($effect['gain_weather_types'], RECOGNIZED_WEATHER_TYPES);
        check(
            "$name: every gain_weather_types entry is a recognized weather constant",
            empty($unrecognizedTypes),
            'unrecognized=' . json_encode(array_values($unrecognizedTypes))
        );
        // Plural is specifically for SEVERAL DIFFERENT specific types in
        // one effect (see PlantCards.php's Gum Tree comment) — WEATHER_ANY
        // has no meaning as one of several "different specific types", and
        // the singular gain_weather_type + gain_weather_qty pair is the
        // right shape for "N of any/one type" instead.
        check(
            "$name: gain_weather_types does not include WEATHER_ANY (use singular gain_weather_type for that)",
            !in_array(PlantCards::WEATHER_ANY, $effect['gain_weather_types'], true)
        );
    }

    if (isset($effect['level_up'])) {
        check(
            "$name: level_up target is a recognized constant",
            in_array($effect['level_up'], RECOGNIZED_LEVEL_UP_TARGETS, true),
            'value=' . json_encode($effect['level_up'])
        );
    }

    if (isset($effect['level_up_family'])) {
        check("$name: level_up_family is boolean true", $effect['level_up_family'] === true);
    }
}

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
