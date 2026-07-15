/**
 * Regression test for https://trello.com/c/rvSEQag1
 * "Bonus Weather card played is not visually reflected in the game"
 *
 * Two related gaps in the old behavior:
 * 1. The player panel's held Sun/Rain/Wind counts didn't drop until the
 *    WeatherPhaseBonus selection was fully submitted (Done / auto-submit) —
 *    even though the status button for that condition had already
 *    disappeared from the selection screen the instant it was clicked (see
 *    https://trello.com/c/Tyxs3bcd). The player panel and the selection
 *    screen told two different stories about the same click for however
 *    long the player kept selecting more cards before submitting.
 * 2. Playing a Bonus Weather card had NO visual representation anywhere —
 *    it just vanished from the held count with nothing appearing anywhere
 *    else, unlike every other "spend/consume a card" action in this game
 *    (plants moving onto planters, hand cards disappearing when discarded
 *    as cost, etc., which all have SOME visible destination).
 *
 * Fix: a played Bonus Weather card now renders as a tile in the player's
 * garden, to the right of their character card (renderPlayedBonusWeather),
 * and applyBonusWeatherPlayed — the single funnel both the optimistic
 * click-time update (WeatherPhaseBonus) and the server-confirmed
 * notif_playerPlayedBonus route through — updates gamedatas and refreshes
 * the player panel in the same call. Cards return to the supply (and their
 * tiles are removed) via notif_weatherCleared once WeatherPhaseGrow
 * processes them, same as before.
 *
 * This test drives the REAL applyBonusWeatherPlayed/renderPlayedBonusWeather/
 * weatherCardBody methods (not a re-implementation) through headless
 * Chrome, and confirms idempotency (calling it twice for the same card,
 * matching the optimistic-then-server-confirmed double-call in production,
 * must not duplicate the DOM tile).
 *
 * Run: node tests/bonusWeatherPlayedVisuals.test.mjs
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

const applyBonusWeatherPlayedBody = extractMethod('applyBonusWeatherPlayed');
const renderPlayedBonusWeatherBody = extractMethod('renderPlayedBonusWeather');
const weatherCardBodyBody = extractMethod('weatherCardBody');
const isCharacterBody = extractMethod('isCharacter');
const notifWeatherClearedBody = extractMethod('notif_weatherCleared');

const script = `
const refreshCalls = [];
const game = {
    gamedatas: {
        weatherPublicBonus: {
            901: { id: 901, type: 'bonus', type_arg: 0, location_arg: 7 },
        },
    },
    isCharacter: new Function('type', ${JSON.stringify(isCharacterBody)}),
    weatherCardBody: new Function('card', 'cardInfo', ${JSON.stringify(weatherCardBodyBody)}),
    renderPlayedBonusWeather: new Function('cards', 'containerId', ${JSON.stringify(renderPlayedBonusWeatherBody)}),
    refreshAllPlayerPanels: () => { refreshCalls.push(true); },
};
game.applyBonusWeatherPlayed = new Function('card', 'playerId', ${JSON.stringify(applyBonusWeatherPlayedBody)}).bind(game);

function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }
function check(label, cond, detail) {
    log((cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : ''));
}

const card = { id: 901, type: 'bonus', type_arg: 0, location_arg: 7 };
game.applyBonusWeatherPlayed(card, 7);

check('card removed from gamedatas.weatherPublicBonus (held count drops immediately)',
    !game.gamedatas.weatherPublicBonus[901]);
check('card added to gamedatas.weatherPlayedBonus',
    !!game.gamedatas.weatherPlayedBonus && !!game.gamedatas.weatherPlayedBonus[901]);
check('refreshAllPlayerPanels was called', refreshCalls.length === 1);

const tile = document.getElementById('garden_weatherbonus_901');
check('a garden tile was rendered for the played card', !!tile);
check('the tile has the bonus-weather sprite class', !!tile && tile.classList.contains('plantopia-bonus-weather-card'));
check('the tile is positioned in the player-garden-planters-7 row (to the right of planters/character)',
    !!tile && tile.parentElement && tile.parentElement.id === 'player-garden-planters-7');

// Idempotency: applyBonusWeatherPlayed gets called twice for the same card
// in production (optimistically at click time, then again when
// notif_playerPlayedBonus confirms it from the server) — must not
// duplicate the tile or otherwise misbehave.
game.applyBonusWeatherPlayed(card, 7);
const tilesAfterSecondCall = document.querySelectorAll('#player-garden-planters-7 [id^="garden_weatherbonus_"]');
check('calling applyBonusWeatherPlayed again for the SAME card does not duplicate its garden tile',
    tilesAfterSecondCall.length === 1, tilesAfterSecondCall.length);
check('refreshAllPlayerPanels was called again (harmless — panel re-render is itself idempotent)',
    refreshCalls.length === 2);

// ── notif_weatherCleared must remove the garden tile once WeatherPhaseGrow
// has returned the card to the supply server-side ──
game.renderPublicWeather = () => {};
game.renderBonusWeatherMarket = () => {};
game.notif_weatherCleared = new Function('args', ${JSON.stringify(notifWeatherClearedBody)}).bind(game);
game.notif_weatherCleared({ weatherPublicBonus: {}, bonusMarket: {} });

check('gamedatas.weatherPlayedBonus is cleared', Object.keys(game.gamedatas.weatherPlayedBonus || {}).length === 0);
check('the garden tile for the returned-to-supply card is removed from the DOM',
    !document.getElementById('garden_weatherbonus_901'));
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="player-garden-planters-7"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-bonusweathervisuals-test-'));
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
