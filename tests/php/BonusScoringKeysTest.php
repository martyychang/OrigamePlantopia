<?php
declare(strict_types=1);

/**
 * Systematic audit requested by Marty (see PlantingEffectKeysTest.php for
 * the planting_effect half of this). This is the bonus_scoring /
 * treat_as half: Game::calculateAllScores() only recognizes a fixed set
 * of bonus_scoring keys and treat_as targets. A card using anything else
 * would score ZERO extra points for that clause with no error — the
 * exact kind of silent, text-says-one-thing-code-does-another gap this
 * audit is meant to catch.
 *
 * Run: php tests/php/BonusScoringKeysTest.php
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

// Every key Game::calculateAllScores() actually reads off bonus_scoring.
const RECOGNIZED_BONUS_SCORING_KEYS = [
    'fixed_points',
    'per_two_cards_in_hand',
    'per_level3',
    'per_baby_tree', 'per_trv_tree',
    'per_baby_cactus', 'per_trv_cactus',
    'per_baby_flower', 'per_trv_flower',
    'per_plant_type',
];

$types = PlantCards::getTypes();

foreach ($types as $name => $info) {
    $bonus = $info['bonus_scoring'] ?? [];
    if (!empty($bonus)) {
        $unknownKeys = array_diff(array_keys($bonus), RECOGNIZED_BONUS_SCORING_KEYS);
        check("$name: bonus_scoring has no unrecognized keys", empty($unknownKeys), 'unknown=' . json_encode($unknownKeys));
    }

    if (isset($info['treat_as'])) {
        foreach ($info['treat_as'] as $targetType => $amount) {
            check(
                "$name: treat_as target '$targetType' is a real plant_type constant",
                in_array($targetType, PlantCards::ALL_TYPES, true)
            );
            check("$name: treat_as amount for '$targetType' is a positive int", is_int($amount) && $amount > 0, "amount=$amount");
        }
    }
}

// Cross-check: every card whose card_effect TEXT names a family
// ("Baby and Treevolved <Family>", "Treevolved <A> or <B>") should score
// bonus points tied to THAT family's per_baby_*/per_trv_* keys. This is
// a heuristic, not a hard rule (a few cards deliberately score off a
// DIFFERENT family than their own — e.g. Impossible Tree is a
// Treevolved Tree that scores off Cactus+Tree, matching its own text
// "Treevolved Cactus or Tree"). What it catches is a card whose bonus
// keys don't match ANY family mentioned in its own text — most likely a
// copy-paste artifact from a sibling card.
// KNOWN, FLAGGED mismatch — https://trello.com/c/DAjjn8IT (filed during
// this audit): Call-A-Lily's card_effect text says "Tree" but its
// bonus_scoring keys score Flower. Awaiting Marty's call on which side
// is the bug (text or scoring). Remove this exception once that's fixed.
const KNOWN_TEXT_MISMATCH_PENDING_CONFIRMATION = ['Call-A-Lily'];

$familyWord = ['cactus' => 'Cactus', 'flower' => 'Flower', 'tree' => 'Tree'];
foreach ($types as $name => $info) {
    if (in_array($name, KNOWN_TEXT_MISMATCH_PENDING_CONFIRMATION, true)) continue;
    $bonus = $info['bonus_scoring'] ?? [];
    $text = $info['card_effect'] ?? '';
    $scoredFamilies = [];
    foreach ($bonus as $key => $amount) {
        foreach (['baby_tree' => 'tree', 'trv_tree' => 'tree', 'baby_cactus' => 'cactus', 'trv_cactus' => 'cactus', 'baby_flower' => 'flower', 'trv_flower' => 'flower'] as $suffix => $family) {
            if ($key === "per_$suffix") $scoredFamilies[$family] = true;
        }
    }
    if (empty($scoredFamilies)) continue; // per_plant_type / per_level3 / per_two_cards_in_hand / fixed_points name no family

    $textFamilies = [];
    foreach ($familyWord as $family => $word) {
        if (str_contains($text, $word)) $textFamilies[$family] = true;
    }
    if (empty($textFamilies)) continue; // text doesn't name any family to cross-check against (shouldn't happen for these keys, but don't false-positive)

    $overlap = array_intersect_key($scoredFamilies, $textFamilies);
    check(
        "$name: bonus_scoring family (" . implode('/', array_keys($scoredFamilies)) . ") matches a family named in its own card_effect text",
        !empty($overlap),
        "text=\"$text\" scores=" . implode('/', array_keys($scoredFamilies))
    );
}

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
