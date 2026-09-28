/**
 * Regression test for https://trello.com/c/NPjdtrY3
 * "Plant cards planted in a player's garden should not be highlighted after planting"
 *
 * renderPlantInPlanter and renderLevel3Plant used to bake a green
 * `border: 2px solid #2ecc71` into the garden-plant template, so a plant kept a
 * green highlight border at rest after being planted. Per the card, garden
 * plants must have NO highlight border at rest — the selection ring is applied
 * transiently only during a Grow step (markSelectableCard) and cleared by
 * cleanupUI. This guards both render templates against the resting border
 * coming back.
 *
 * Run: node tests/gardenPlantNoBorder.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

function extractMethod(name) {
    const re = new RegExp(`\\n    ${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

// Pull the inline style of the `garden_plant_${card.id}` <div> in a method.
function gardenPlantStyle(methodSrc, methodName) {
    const m = methodSrc.match(/id="garden_plant_\$\{card\.id\}"[\s\S]*?style="([^"]*)"/);
    assert.ok(m, `could not find garden_plant div style in ${methodName}`);
    return m[1];
}

function assertNoBorder(style, where) {
    const withoutRadius = style.replace(/border-radius:[^;]*;?/g, '');
    assert.ok(!/\bborder(-\w+)?\s*:/.test(withoutRadius),
        `${where} should carry no highlight border at rest, got: "${style}"`);
}

t('renderPlantInPlanter garden plant has no resting border', () => {
    assertNoBorder(gardenPlantStyle(extractMethod('renderPlantInPlanter'), 'renderPlantInPlanter'), 'renderPlantInPlanter');
});

t('renderLevel3Plant garden plant has no resting border', () => {
    assertNoBorder(gardenPlantStyle(extractMethod('renderLevel3Plant'), 'renderLevel3Plant'), 'renderLevel3Plant');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
