/**
 * Regression test for https://trello.com/c/CUKgx2vL
 * "Dark mode: no CSS handling, likely illegible cards"
 *
 * Marty tested the game live under BGA's dark mode: mostly fine, but the
 * "<Player>'s Garden", "Bonus Weather", and "Public Weather Cards" section
 * headers rendered in white text on their own deliberately-light
 * rgba(255,255,255,0.8) container background — illegible, since dark mode
 * flips the page's DEFAULT text color to something light without touching
 * an explicitly-set light background. Fixed by pairing an explicit dark
 * `color` with that background on all three containers, the same way the
 * draft-keep modal already pairs `color: white` with its own dark
 * rgba(0,0,0,0.8) backdrop.
 *
 * A full headless-Chrome render of setup() would need the whole gamedatas
 * shape mocked for little added confidence over a direct source check —
 * this instead asserts, directly against the real Game.js source, that
 * each of the three specific containers Marty reported still carries its
 * own explicit `color`, so a future edit can't silently drop it and
 * regress this exact bug. (Other light-background sections in this file —
 * "Characters", "My Hand" — set color on their own `<h3>` directly instead
 * of the container; both are equally valid places for it, so this test
 * doesn't demand one approach over the other, just that ONE of them holds
 * for these three specific headers.)
 *
 * Run: node tests/darkModeHeaderContrast.test.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

let failures = 0;
function check(label, cond, detail) {
    if (cond) {
        console.log('  ok — ' + label);
    } else {
        console.log('  FAIL — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : ''));
        failures++;
    }
}

// The three specific headers Marty flagged must still render inside a
// container that sets color explicitly (not just "some rgba block
// somewhere has color" — tie it to the actual reported headers).
const headerChecks = [
    { label: "<Player>'s Garden", re: /<div id="player-table-\$\{player\.id\}" style="[^"]*color:\s*#[0-9a-fA-F]{3,6}[^"]*">\s*<h3>\$\{player\.name\}'s Garden<\/h3>/ },
    { label: 'Bonus Weather', re: /<div id="bonus-weather-section" style="[^"]*color:\s*#[0-9a-fA-F]{3,6}[^"]*">\s*<h3[^>]*>Bonus Weather<\/h3>/ },
    { label: 'Public Weather Cards', re: /<div id="public-weather-section" style="[^"]*color:\s*#[0-9a-fA-F]{3,6}[^"]*">\s*<h3[^>]*>Public Weather Cards<\/h3>/ },
];
for (const { label, re } of headerChecks) {
    check(`"${label}" header's container has an explicit dark color`, re.test(src));
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
