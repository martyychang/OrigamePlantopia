/**
 * Standalone Node test for Game.js's growLevelsLabel(qty) helper — the
 * pluralized "N level(s)" phrase appended to grow-effect prompts so the
 * player can see how many levels the effect grants (Trello NGVQocFa:
 * Arrowhead grows by 1, Buttercup by 2).
 *
 * Pulls the real method body out of Game.js (production code) and stubs _().
 *
 * Run: node tests/growLevelsLabel.test.mjs
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

// BGA's gettext global: identity stub.
global._ = (s) => s;
const growLevelsLabel = new Function('qty', extractMethod('growLevelsLabel'));

let failures = 0;
function check(label, got, want) {
    if (got === want) { console.log(`  ok  — ${label}`); }
    else { console.log(`  FAIL — ${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); failures++; }
}

check('qty 1 → singular "1 level"', growLevelsLabel(1), '1 level');
check('qty 2 → "2 levels"', growLevelsLabel(2), '2 levels');
check('qty 3 → "3 levels"', growLevelsLabel(3), '3 levels');
check('string "2" → "2 levels"', growLevelsLabel('2'), '2 levels');
check('undefined qty defaults to "1 level"', growLevelsLabel(undefined), '1 level');
check('qty 0 defaults to "1 level"', growLevelsLabel(0), '1 level');
check('negative qty clamps to "1 level"', growLevelsLabel(-5), '1 level');

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
