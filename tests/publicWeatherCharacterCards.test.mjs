/**
 * Regression test for https://trello.com/c/rwdYylsO
 * "Character Weather cards drawn and flipped as public weather cards during
 * the Weather Phase show placeholder text instead of images"
 *
 * Root cause: every physical weather card is either a character card
 * (banana/carrot/mushroom/potato/tomato) or a bonus card — there is no
 * plain sun/rain/wind card type (see WeatherCards::getTypes()). The hand
 * and bonus-market renderers already route through weatherCardBody(), which
 * emits the right CSS sprite class/data-attrs for both. But
 * renderPublicWeather() (the "Public Weather Cards" section, fed by
 * weather_public — cards drawn from the deck or revealed from a played
 * hand card during the Weather Phase) had its own hardcoded rendering that
 * always showed cardInfo.name as plain text, regardless of card type. So a
 * character weather card landing in weather_public showed as a name in an
 * orange box instead of its sprite art.
 *
 * Fix: renderPublicWeather() now calls the same weatherCardBody() helper
 * used elsewhere, so it gets the correct sprite class + data-character-type
 * / data-weather-condition attributes.
 *
 * Extracts the real weatherCardBody + renderPublicWeather methods (same
 * technique as the other headless-Chrome tests in this suite) so this
 * exercises production code.
 *
 * Run: node tests/publicWeatherCharacterCards.test.mjs
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

const weatherCardBodyBody = extractMethod('weatherCardBody');
const isCharacterBody = extractMethod('isCharacter');
const renderPublicWeatherBody = extractMethod('renderPublicWeather');

const script = `
function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }

const game = {
    gamedatas: {
        weatherCardTypes: {
            carrot: { cards: { 1: { name: 'Carrot Rain' } } },
            potato: { cards: { 0: { name: 'Potato Sun' } } },
            bonus:  { cards: { 0: { name: 'Sunny Bonus' } } },
        },
    },
    isCharacter: new Function('type', ${JSON.stringify(isCharacterBody)}),
    weatherCardBody: new Function('card', 'cardInfo', ${JSON.stringify(weatherCardBodyBody)}),
    renderPublicWeather: new Function('weatherData', ${JSON.stringify(renderPublicWeatherBody)}),
};

const weatherData = {
    701: { id: 701, type: 'carrot', type_arg: 1 },  // Carrot Rain (character weather card)
    702: { id: 702, type: 'potato', type_arg: 0 },  // Potato Sun (character weather card)
    703: { id: 703, type: 'bonus', type_arg: 0 },   // a bonus card, in case one is ever revealed publicly
};
game.renderPublicWeather(weatherData);

const carrot = document.getElementById('weather_701');
const potato = document.getElementById('weather_702');
const bonus = document.getElementById('weather_703');

const checks = [
    ['Carrot Rain card rendered', !!carrot],
    ['Carrot Rain has the character-weather sprite class', !!carrot && carrot.classList.contains('plantopia-character-weather-card')],
    ['Carrot Rain has data-character-type="carrot"', !!carrot && carrot.dataset.characterType === 'carrot'],
    ['Carrot Rain has data-weather-condition="rain"', !!carrot && carrot.dataset.weatherCondition === 'rain'],
    ['Carrot Rain has NO leftover text label (art only, no bold name element)', !!carrot && !carrot.innerHTML.includes('Carrot Rain')],
    ['Potato Sun has the character-weather sprite class', !!potato && potato.classList.contains('plantopia-character-weather-card')],
    ['Potato Sun has data-character-type="potato"', !!potato && potato.dataset.characterType === 'potato'],
    ['bonus card still gets the bonus-weather sprite class', !!bonus && bonus.classList.contains('plantopia-bonus-weather-card')],
];
checks.forEach(([label, cond]) => log((cond ? 'ok' : 'FAIL') + ' — ' + label));
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="weather-public-container"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-publicweather-test-'));
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
