/**
 * Regression test for https://trello.com/c/cPxcQy2A
 * "Redesign plant counts in player panel to be more compact"
 *
 * The player panel used to show plant counts as three text lines (one per
 * family), each joining all 4 levels with " / " — e.g. "🌵 0/1/0/2  🌵 0/0/0/1".
 * Marty asked for a compact column-based table instead: 7 columns
 * (baby/adult × tree/flower/cactus, THEN the level label last — moved
 * there from the left on 2026-07-19), 5 rows (Lv. 3 / Lv. 2 / Lv. 1 /
 * Lv. 0 counts, then a label-less row of family icons). Marty first said 4
 * rows (no Lv. 0), then self-corrected once he remembered plants start at
 * level 0 when first planted. Zero counts render as blank cells, not "0".
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

const cssPath = new URL('../plantopia/plantopia.css', import.meta.url).pathname;
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

// Baby Cactus lv2=1, Adult Cactus lv3=2, Baby Flower lv1=3, Adult Tree lv1=1,
// Baby Tree lv0=4 (freshly planted, not yet grown). Everything else zero.
const s = {
    plants: {
        cactus: { baby: [0, 0, 1, 0], adult: [0, 0, 0, 2] },
        flower: { baby: [0, 3, 0, 0], adult: [0, 0, 0, 0] },
        tree:   { baby: [4, 0, 0, 0], adult: [0, 1, 0, 0] },
    },
};

document.getElementById('container').innerHTML = plantCountsTableHtml(s);
const table = document.querySelector('.plantopia-panel-table');
check('a table renders', !!table);

const rows = table ? Array.from(table.querySelectorAll('tr')) : [];
check('exactly 5 rows (Lv.3 / Lv.2 / Lv.1 / Lv.0 / icon row)', rows.length === 5, rows.length);

// Label is now the LAST cell in each row (moved from first on 2026-07-19).
const rowLabels = rows.map(r => r.children[r.children.length - 1].textContent.trim());
check('row labels are Lv. 3, Lv. 2, Lv. 1, Lv. 0, then blank — in that top-to-bottom order, in the LAST column',
    JSON.stringify(rowLabels) === JSON.stringify(['Lv. 3', 'Lv. 2', 'Lv. 1', 'Lv. 0', '']), rowLabels);

// Column order: baby_tree, adult_tree, baby_flower, adult_flower, baby_cactus, adult_cactus, then the label.
const iconRow = rows[4];
const iconOrder = Array.from(iconRow.children).slice(0, -1).map(td => {
    const iconEl = td.querySelector('.plantopia-panel-icon');
    return iconEl ? iconEl.dataset.icon : null;
});
check('icon row columns are ordered baby_tree, adult_tree, baby_flower, adult_flower, baby_cactus, adult_cactus',
    JSON.stringify(iconOrder) === JSON.stringify(['baby_tree', 'adult_tree', 'baby_flower', 'adult_flower', 'baby_cactus', 'adult_cactus']),
    iconOrder);

// Lv. 3 row: only Adult Cactus (column 6) shows a count (2); everything else blank.
const lv3Cells = Array.from(rows[0].children).slice(0, -1).map(td => td.textContent.trim());
check('Lv. 3 row: Adult Cactus column shows 2, every other data column is blank',
    JSON.stringify(lv3Cells) === JSON.stringify(['', '', '', '', '', '2']), lv3Cells);

// Lv. 2 row: only Baby Cactus (column 5) shows 1.
const lv2Cells = Array.from(rows[1].children).slice(0, -1).map(td => td.textContent.trim());
check('Lv. 2 row: Baby Cactus column shows 1, every other data column is blank',
    JSON.stringify(lv2Cells) === JSON.stringify(['', '', '', '', '1', '']), lv2Cells);

// Lv. 1 row: Adult Tree (column 2) shows 1, Baby Flower (column 3) shows 3.
const lv1Cells = Array.from(rows[2].children).slice(0, -1).map(td => td.textContent.trim());
check('Lv. 1 row: Adult Tree shows 1, Baby Flower shows 3, everything else blank',
    JSON.stringify(lv1Cells) === JSON.stringify(['', '1', '3', '', '', '']), lv1Cells);

// Lv. 0 row: only Baby Tree (column 1) shows a count (4) — freshly planted.
const lv0Cells = Array.from(rows[3].children).slice(0, -1).map(td => td.textContent.trim());
check('Lv. 0 row: Baby Tree column shows 4, every other data column is blank',
    JSON.stringify(lv0Cells) === JSON.stringify(['4', '', '', '', '', '']), lv0Cells);

// Check DATA cells only (not the last column, which legitimately says
// "Lv. 0") — no count cell should ever render a literal "0".
const allDataCells = rows.flatMap(r => Array.from(r.children).slice(0, -1).map(td => td.textContent.trim()));
check('no literal "0" text in any count cell (zero counts are hidden, not printed)',
    !allDataCells.includes('0'), JSON.stringify(allDataCells));

// ── Real border rules from the real stylesheet (loaded via <link> below),
//    not just the HTML structure — border layout has been revised 3 times
//    (left-open corner -> closing right edge -> full grid -> label moved
//    to the last column, exception follows it to bottom-right), exactly
//    the kind of detail that regresses silently without a computed-style
//    check. ──
const lastRow = rows[rows.length - 1]; // icon row
const bottomRight = lastRow.children[lastRow.children.length - 1]; // blank label cell
const bottomSecondToLast = lastRow.children[lastRow.children.length - 2]; // adult_cactus icon cell
const topRight = rows[0].children[rows[0].children.length - 1]; // Lv. 3 label cell
function borderStyles(el) {
    const cs = getComputedStyle(el);
    return { top: cs.borderTopStyle, right: cs.borderRightStyle, bottom: cs.borderBottomStyle, left: cs.borderLeftStyle };
}
const bottomRightBorders = borderStyles(bottomRight);
check('bottom-right cell (blank label cell of the icon row) has no right border',
    bottomRightBorders.right === 'none', JSON.stringify(bottomRightBorders));
check('bottom-right cell has no bottom border',
    bottomRightBorders.bottom === 'none', JSON.stringify(bottomRightBorders));
check('bottom-right cell still has a top and left border (only right+bottom are excepted)',
    bottomRightBorders.top === 'solid' && bottomRightBorders.left === 'solid', JSON.stringify(bottomRightBorders));
check('its left neighbor (adult_cactus icon cell) keeps its own right border — the exception did not bleed sideways',
    getComputedStyle(bottomSecondToLast).borderRightStyle === 'solid', getComputedStyle(bottomSecondToLast).borderRightStyle);
const topRightBorders = borderStyles(topRight);
check('top-right cell (Lv. 3 label) has a full border on every side — it is NOT the excepted cell',
    topRightBorders.top === 'solid' && topRightBorders.right === 'solid' && topRightBorders.bottom === 'solid' && topRightBorders.left === 'solid',
    JSON.stringify(topRightBorders));
check('level labels have no drop shadow (removed per follow-up request)',
    getComputedStyle(document.querySelector('.plantopia-panel-level-label')).textShadow === 'none',
    getComputedStyle(document.querySelector('.plantopia-panel-level-label')).textShadow);
check('table has 6px of top margin, separating it from the counter row above (per follow-up request)',
    getComputedStyle(table).marginTop === '6px', getComputedStyle(table).marginTop);

// A second render with an all-zero player must still produce the 5-row
// skeleton (labels + icon row), just with every count cell blank — not an
// empty/collapsed table.
const zeroStats = { plants: {
    cactus: { baby: [0,0,0,0], adult: [0,0,0,0] },
    flower: { baby: [0,0,0,0], adult: [0,0,0,0] },
    tree:   { baby: [0,0,0,0], adult: [0,0,0,0] },
} };
document.getElementById('container').innerHTML = plantCountsTableHtml(zeroStats);
const zeroRows = document.querySelectorAll('.plantopia-panel-table tr');
check('an all-zero player still renders the full 5-row skeleton',
    zeroRows.length === 5, zeroRows.length);
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${cssPath}"></head><body>
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
