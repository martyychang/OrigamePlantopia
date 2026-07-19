/**
 * Regression test for https://trello.com/c/cPxcQy2A
 * "Redesign plant counts in player panel to be more compact"
 *
 * The player panel used to show plant counts as three text lines (one per
 * family), each joining all 4 levels with " / " — e.g. "🌵 0/1/0/2  🌵 0/0/0/1".
 * Marty asked for a compact column-based table instead: 7 columns (level
 * label + baby/adult × tree/flower/cactus), 4 rows (Lv. 3 / Lv. 2 / Lv. 1
 * counts, then a label-less row of family icons) — confirmed on the card
 * (2026-07-18) that there's deliberately no "Lv. 0" row, only vertical
 * column separators, and zero counts render as blank cells, not "0".
 *
 * This drives the REAL Game.plantCountsTableHtml (plus the real
 * Game.PANEL_ICON_TOOLTIPS / Game.PLANT_COUNT_COLUMNS static data it
 * reads), not a re-implementation, through headless Chrome for a real
 * parsed DOM.
 *
 * Run: node tests/plantCountsTable.test.mjs
 * Requires: Google Chrome at the path below (macOS default location).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

function extractMethod(name) {
    const re = new RegExp(`\\n    (?:async )?${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}\\n`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

// Static class fields (e.g. `static NAME = {...};` / `static NAME = [...];`)
// aren't methods, so extractMethod's regex doesn't fit — brace/bracket-match
// from the `=` instead, same bracket-depth technique used elsewhere in this
// suite for isolating a self-contained snippet out of the full file.
function extractStaticField(name) {
    const marker = `static ${name} = `;
    const startIdx = src.indexOf(marker);
    if (startIdx === -1) throw new Error(`extractStaticField failed for ${name}`);
    const valueStart = startIdx + marker.length;
    let depth = 0;
    let started = false;
    let i = valueStart;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{' || ch === '[') { depth++; started = true; }
        else if (ch === '}' || ch === ']') { depth--; if (started && depth === 0) { i++; break; } }
    }
    return src.slice(valueStart, i);
}

const plantCountsTableHtmlBody = extractMethod('plantCountsTableHtml');
const panelIconTooltips = extractStaticField('PANEL_ICON_TOOLTIPS');
const plantCountColumns = extractStaticField('PLANT_COUNT_COLUMNS');

const script = `
function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }
function check(label, cond, detail) {
    log((cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : ''));
}

// Game.PANEL_ICON_TOOLTIPS / Game.PLANT_COUNT_COLUMNS are static class
// fields the real method reads via \`Game.\` — provide the same real data
// under that name at global scope.
const Game = {
    PANEL_ICON_TOOLTIPS: ${panelIconTooltips},
    PLANT_COUNT_COLUMNS: ${plantCountColumns},
};

const plantCountsTableHtml = new Function('s', ${JSON.stringify(plantCountsTableHtmlBody)});

// Baby Cactus lv2=1, Adult Cactus lv3=2, Baby Flower lv1=3, Adult Tree lv1=1.
// Everything else zero — including ALL of level 0, which must never show a
// row at all.
const s = {
    plants: {
        cactus: { baby: [0, 0, 1, 0], adult: [0, 0, 0, 2] },
        flower: { baby: [0, 3, 0, 0], adult: [0, 0, 0, 0] },
        tree:   { baby: [0, 0, 0, 0], adult: [0, 1, 0, 0] },
    },
};

document.getElementById('container').innerHTML = plantCountsTableHtml(s);
const table = document.querySelector('.plantopia-panel-table');
check('a table renders', !!table);

const rows = table ? Array.from(table.querySelectorAll('tr')) : [];
check('exactly 4 rows (Lv.3 / Lv.2 / Lv.1 / icon row) — no Lv. 0 row', rows.length === 4, rows.length);

const rowLabels = rows.map(r => r.children[0].textContent.trim());
check('row labels are Lv. 3, Lv. 2, Lv. 1, then blank — in that top-to-bottom order',
    JSON.stringify(rowLabels) === JSON.stringify(['Lv. 3', 'Lv. 2', 'Lv. 1', '']), rowLabels);

// Column order: baby_tree, adult_tree, baby_flower, adult_flower, baby_cactus, adult_cactus.
const iconRow = rows[3];
const iconOrder = Array.from(iconRow.children).slice(1).map(td => {
    const iconEl = td.querySelector('.plantopia-panel-icon');
    return iconEl ? iconEl.dataset.icon : null;
});
check('icon row columns are ordered baby_tree, adult_tree, baby_flower, adult_flower, baby_cactus, adult_cactus',
    JSON.stringify(iconOrder) === JSON.stringify(['baby_tree', 'adult_tree', 'baby_flower', 'adult_flower', 'baby_cactus', 'adult_cactus']),
    iconOrder);

// Lv. 3 row: only Adult Cactus (column 6) shows a count (2); everything else blank.
const lv3Cells = Array.from(rows[0].children).slice(1).map(td => td.textContent.trim());
check('Lv. 3 row: Adult Cactus column shows 2, every other column is blank',
    JSON.stringify(lv3Cells) === JSON.stringify(['', '', '', '', '', '2']), lv3Cells);

// Lv. 2 row: only Baby Cactus (column 5) shows 1.
const lv2Cells = Array.from(rows[1].children).slice(1).map(td => td.textContent.trim());
check('Lv. 2 row: Baby Cactus column shows 1, every other column is blank',
    JSON.stringify(lv2Cells) === JSON.stringify(['', '', '', '', '1', '']), lv2Cells);

// Lv. 1 row: Adult Tree (column 2) shows 1, Baby Flower (column 3) shows 3.
const lv1Cells = Array.from(rows[2].children).slice(1).map(td => td.textContent.trim());
check('Lv. 1 row: Adult Tree shows 1, Baby Flower shows 3, everything else blank',
    JSON.stringify(lv1Cells) === JSON.stringify(['', '1', '3', '', '', '']), lv1Cells);

check('no literal "0" text anywhere in the table (zero counts are hidden, not printed)',
    !table.textContent.includes('0'), table.textContent);

// A second render with an all-zero player must still produce the 4-row
// skeleton (labels + icon row), just with every count cell blank — not an
// empty/collapsed table.
const zeroStats = { plants: {
    cactus: { baby: [0,0,0,0], adult: [0,0,0,0] },
    flower: { baby: [0,0,0,0], adult: [0,0,0,0] },
    tree:   { baby: [0,0,0,0], adult: [0,0,0,0] },
} };
document.getElementById('container').innerHTML = plantCountsTableHtml(zeroStats);
const zeroRows = document.querySelectorAll('.plantopia-panel-table tr');
check('an all-zero player still renders the full 4-row skeleton',
    zeroRows.length === 4, zeroRows.length);
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="container"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-plantcountstable-test-'));
const htmlPath = path.join(dir, 'test.html');
writeFileSync(htmlPath, html);

let dump;
try {
    dump = execFileSync(CHROME, ['--headless', '--disable-gpu', '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8' });
} finally {
    rmSync(dir, { recursive: true, force: true });
}

const resultsMatch = dump.match(/<div id="results">([\s\S]*?)<\/div>/);
if (!resultsMatch) {
    console.error('FAIL — could not find #results in the headless Chrome DOM dump; is Chrome installed at the expected path?');
    process.exit(1);
}
const lines = resultsMatch[1].split('<br>').map((s) => s.trim()).filter(Boolean);

let failures = 0;
for (const line of lines) {
    console.log('  ' + line);
    if (line.startsWith('FAIL')) failures++;
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
