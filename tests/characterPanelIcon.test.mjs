/**
 * Regression test for https://trello.com/c/Zn3wKWxj
 * "Use an icon to represent the player's chosen character instead of
 * displaying the card"
 *
 * A claimed character used to render as a full-size card appended into the
 * player's garden row (player-garden-planters-<id>), competing for space
 * with planters and Bonus Weather tiles. Fix: the garden row no longer
 * renders a claimed character at all — renderPlayerPanel now embeds a
 * small icon (left of the hand count) computed fresh from
 * gamedatas.claimedCharacters, with a tooltip (addCharacterTooltip)
 * showing the full-size card on hover, same as the existing selection
 * panel's cards.
 *
 * notif_characterClaimed / notif_characterReturned used to DOM-move the
 * SAME card element between #available-characters-container and the
 * garden row. Now they just update gamedatas (available <-> claimed) and
 * re-render both affected spots from that data — consistent with how
 * every other part of this client resyncs from gamedatas rather than
 * patching the DOM directly.
 *
 * This drives the REAL renderPlayerPanel / renderCharacters /
 * addCharacterTooltip / notif_characterClaimed / notif_characterReturned
 * / computePlayerStats methods (not re-implementations), extracted out of
 * Game.js, through headless Chrome for a real DOM — same technique as
 * bonusWeatherPlayedVisuals.test.mjs.
 *
 * Run: node tests/characterPanelIcon.test.mjs
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

const computePlayerStatsBody = extractMethod('computePlayerStats');
const isAdultBody = extractMethod('isAdult');
const isBabyTypeBody = extractMethod('isBabyType');
const renderPlayerPanelBody = extractMethod('renderPlayerPanel');
const addCharacterTooltipBody = extractMethod('addCharacterTooltip');
const renderCharactersBody = extractMethod('renderCharacters');
const notifCharacterClaimedBody = extractMethod('notif_characterClaimed');
const notifCharacterReturnedBody = extractMethod('notif_characterReturned');

const script = `
function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }
function check(label, cond, detail) {
    log((cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : ''));
}

// renderPlayerPanel references the static Game.PANEL_ICON_TOOLTIPS map —
// empty is fine here, we're not asserting plant-stat tooltip text.
const Game = { PANEL_ICON_TOOLTIPS: {} };

const tooltipCalls = [];
const game = {
    gamedatas: {
        availableCharacters: { 901: { id: 901, type: 'mushroom', location_arg: null } },
        claimedCharacters: {},
        characterCardTypes: { mushroom: { name: 'Mushroom', ability: 'Start with 1 of each Bonus Weather Card.' } },
        handCounts: {}, plantsOnPlanters: {}, plantsLevel3: {}, planters: {}, weatherPublicBonus: {},
    },
    bga: {
        gameui: { addTooltipHtml: (nodeId, html) => tooltipCalls.push(nodeId) },
        states: { getCurrentMainStateName: () => 'SomeOtherState' },
        players: { getCurrentPlayerId: () => 7 },
    },
    setupDecisions: { onEnteringState: () => {} },
};
game.isAdult = new Function('plantType', ${JSON.stringify(isAdultBody)});
game.isBabyType = new Function('plantType', ${JSON.stringify(isBabyTypeBody)});
game.computePlayerStats = new Function('playerId', ${JSON.stringify(computePlayerStatsBody)}).bind(game);
game.addCharacterTooltip = new Function('nodeId', 'cardInfo', ${JSON.stringify(addCharacterTooltipBody)}).bind(game);
game.renderCharacters = new Function('cards', 'containerId', ${JSON.stringify(renderCharactersBody)}).bind(game);
game.renderPlayerPanel = new Function('playerId', ${JSON.stringify(renderPlayerPanelBody)}).bind(game);
game.notif_characterClaimed = new Function('args', ${JSON.stringify(notifCharacterClaimedBody)}).bind(game);
game.notif_characterReturned = new Function('args', ${JSON.stringify(notifCharacterReturnedBody)}).bind(game);

// ── Before claiming: panel renders with no character icon ──
game.renderPlayerPanel(7);
check('no character icon before a character is claimed', !document.getElementById('character-icon-7'));

// ── Claim: gamedatas moves available -> claimed, panel gets the icon,
//    selection pool loses the card, garden row stays empty ──
game.notif_characterClaimed({ player_id: 7, card: { id: 901, type: 'mushroom', location_arg: 7 } });

check('card removed from gamedatas.availableCharacters', !game.gamedatas.availableCharacters[901]);
check('card added to gamedatas.claimedCharacters', !!game.gamedatas.claimedCharacters[901]);

const iconEl = document.getElementById('character-icon-7');
check('character icon now rendered in the player panel', !!iconEl);
check('icon is keyed by the correct character type', !!iconEl && iconEl.dataset.characterType === 'mushroom');
check('icon has the small-icon sprite class (not the full-size card class)',
    !!iconEl && iconEl.classList.contains('plantopia-character-icon') && !iconEl.classList.contains('plantopia-character-power-card'));

const panelHtml = document.getElementById('plantopia-panel-7').innerHTML;
check('icon is positioned BEFORE the hand count icon on the same line',
    panelHtml.indexOf('character-icon-7') !== -1 && panelHtml.indexOf('character-icon-7') < panelHtml.indexOf('data-icon="hand"'));

check('hovering the icon wires a tooltip (full-size card on hover)', tooltipCalls.includes('character-icon-7'));

check('claimed character is NOT rendered into the garden row (moved to the panel instead)',
    document.getElementById('player-garden-planters-7').children.length === 0);
check('claimed card removed from the available-characters selection pool',
    !document.getElementById('character_901') || document.getElementById('character_901').parentElement.id !== 'available-characters-container');

// ── Return: gamedatas moves claimed -> available, panel loses the icon,
//    selection pool gets the card back ──
game.notif_characterReturned({ player_id: 7, card: { id: 901, type: 'mushroom', location_arg: null } });

check('card removed from gamedatas.claimedCharacters', !game.gamedatas.claimedCharacters[901]);
check('card added back to gamedatas.availableCharacters', !!game.gamedatas.availableCharacters[901]);
check('character icon removed from the player panel after returning', !document.getElementById('character-icon-7'));
check('card reappears in the available-characters selection pool',
    !!document.getElementById('character_901') && document.getElementById('character_901').parentElement.id === 'available-characters-container');
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="plantopia-panel-7"></div>
<div id="available-characters-container"></div>
<div id="player-garden-planters-7"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-charactericon-test-'));
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
