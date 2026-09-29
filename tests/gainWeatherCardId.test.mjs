/**
 * Regression test for https://trello.com/c/XNjeXYlL (BGA Studio error #678759)
 * "Unable to obtain bonus weather cards."
 *
 * Planting a card with a gain-bonus-weather ability (e.g. Geometree) and using
 * it threw `BadMethodCallException: actResolveGainWeather parameter cardId is
 * mandatory`. The gain_weather effect handler reads `el.dataset.id` off each
 * reserve card in #bonus-weather-container and sends it as the cardId — but
 * renderBonusWeatherMarket only set the element's `id` (`weather_<id>`), never
 * `data-id`, so `dataset.id` was undefined and the action went out with an
 * empty cardId.
 *
 * Drives the REAL renderBonusWeatherMarket against a minimal document stub and
 * asserts every reserve card carries a data-id equal to its card id.
 *
 * Run: node tests/gainWeatherCardId.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');
// Brace-matched extraction of a method body (regex non-greedy stops at the
// first dedent-`}`, which over-captures when the body has same-indent blocks).
function extractMethod(name) {
    const sig = new RegExp(`\\n    ${name}\\([^)]*\\)\\s*\\{`);
    const m = src.match(sig);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    let i = m.index + m[0].length; // just past the opening {
    let depth = 1;
    const bodyStart = i;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(bodyStart, i);
}

function makeEl() {
    return {
        id: '', className: '', innerHTML: '', style: {}, dataset: {},
        children: [],
        setAttribute(k, v) { this[k] = v; },
        appendChild(c) { this.children.push(c); },
        addEventListener() {},
    };
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

const container = makeEl();
global.document = {
    getElementById: (id) => (id === 'bonus-weather-container' ? container : null),
    createElement: () => makeEl(),
    // renderBonusWeatherMarket ends by querying the just-rendered cards to
    // attach hover handlers — return the flattened card elements.
    querySelectorAll: () => container.children.flatMap(g => g.children),
};

const ctx = {
    gamedatas: { weatherCardTypes: { bonus: { cards: { 0: {}, 1: {}, 2: {} } } } },
    weatherCardBody: () => ({ extraClass: '', dataAttr: '', inner: '' }),
};
ctx.renderBonusWeatherMarket = new Function('marketData', 'containerId', extractMethod('renderBonusWeatherMarket')).bind(ctx);

const marketData = {
    501: { id: 501, type: 'bonus', type_arg: 0 }, // Sun
    502: { id: 502, type: 'bonus', type_arg: 2 }, // Wind
    503: { id: 503, type: 'bonus', type_arg: 1 }, // Rain
};
ctx.renderBonusWeatherMarket(marketData, 'bonus-weather-container');

// Collect every rendered reserve card element (groupDiv > cardEl).
const cardEls = container.children.flatMap(g => g.children);

t('all three reserve cards rendered', () => {
    assert.equal(cardEls.length, 3, `got ${cardEls.length}`);
});

t('every reserve card carries a data-id equal to its card id (not undefined)', () => {
    for (const el of cardEls) {
        const idFromDom = String(el.id).replace('weather_', '');
        assert.ok(el.dataset.id !== undefined && el.dataset.id !== '',
            `card ${el.id} has empty data-id — actResolveGainWeather would send an empty cardId`);
        assert.equal(String(el.dataset.id), idFromDom,
            `data-id (${el.dataset.id}) must match the card id (${idFromDom})`);
    }
});

// Lock the other side of the contract: the handler reads dataset.id and sends it.
t('gain_weather handler still reads dataset.id into actResolveGainWeather', () => {
    const idx = src.indexOf("effect.type === 'gain_weather'");
    assert.ok(idx > 0, 'gain_weather branch not found');
    const window = src.slice(idx, idx + 700);
    assert.match(window, /actResolveGainWeather.*cardId:\s*el\.dataset\.id/s,
        'handler no longer reads el.dataset.id — keep it in sync with the data-id set above');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
