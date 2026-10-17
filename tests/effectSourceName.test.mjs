/**
 * Standalone Node test for Game.js's effectSourceName(effect) helper — returns
 * the display name of the plant whose effect is being resolved (from the
 * server-stamped source_type), used to prefix resolution prompts like
 * "Buttercup: Choose a plant in your garden to grow" (Trello XKfMDTCy).
 *
 * Pulls the real method body out of Game.js (production code).
 *
 * Run: node tests/effectSourceName.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');
function extractMethod(name) {
    const at = src.indexOf(`\n    ${name}(`);
    if (at === -1) throw new Error(`extractMethod failed for ${name}`);
    const braceOpen = src.indexOf('{', at);
    let i = braceOpen + 1, depth = 1;
    const start = i;
    for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; } }
    return src.slice(start, i);
}

const ctx = {
    gamedatas: {
        plantCardTypes: {
            Buttercup: { name: 'Buttercup', plant_type: 'baby_flower' },
            Geometree: { name: 'Geometree', plant_type: 'trv_tree' },
        },
    },
};
ctx.effectSourceName = new Function('effect', extractMethod('effectSourceName')).bind(ctx);

let failures = 0;
function check(label, got, want) {
    if (got === want) { console.log(`  ok  — ${label}`); }
    else { console.log(`  FAIL — ${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); failures++; }
}

check('known source_type → plant name', ctx.effectSourceName({ type: 'level_up', source_type: 'Buttercup' }), 'Buttercup');
check('another known source_type', ctx.effectSourceName({ type: 'gain_weather', source_type: 'Geometree' }), 'Geometree');
check('no source_type (draw-5 action / character ability) → empty', ctx.effectSourceName({ type: 'draft_cards' }), '');
check('unknown source_type not in plantCardTypes → empty', ctx.effectSourceName({ type: 'level_up', source_type: 'Nonesuch' }), '');
check('null effect → empty', ctx.effectSourceName(null), '');

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
