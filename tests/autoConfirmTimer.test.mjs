/**
 * Regression test for https://trello.com/c/hsdoZGId (auto-confirm follow-up).
 *
 * The cost-payment Confirm button auto-fires on a timer so the player doesn't
 * have to click it. The framework's own `autoclick: true` delay felt too slow,
 * so PlantingPhase now runs a self-managed timer: scheduleAutoConfirm(cb) must
 * fire `cb` after EXACTLY 3000ms, and any rebuild/cleanup (clearAutoConfirm)
 * must cancel a pending fire — otherwise deselecting a card wouldn't stop the
 * confirm.
 *
 * Drives the REAL scheduleAutoConfirm / clearAutoConfirm extracted from Game.js
 * against a stubbed setTimeout/clearTimeout (Node only).
 *
 * Run: node tests/autoConfirmTimer.test.mjs
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

// Controllable fake clock: capture (cb, delay) pairs; fire() runs them.
function buildCtx() {
    const scheduled = new Map();
    let nextId = 1;
    global.setTimeout = (cb, delay) => { const id = nextId++; scheduled.set(id, { cb, delay }); return id; };
    global.clearTimeout = (id) => { scheduled.delete(id); };
    const ctx = { autoConfirmTimer: null };
    ctx.scheduleAutoConfirm = new Function('cb', extractMethod('scheduleAutoConfirm')).bind(ctx);
    ctx.clearAutoConfirm = new Function(extractMethod('clearAutoConfirm')).bind(ctx);
    return { ctx, scheduled };
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

t('scheduleAutoConfirm arms a timer for exactly 3000ms', () => {
    const { ctx, scheduled } = buildCtx();
    ctx.scheduleAutoConfirm(() => {});
    const entry = scheduled.get(ctx.autoConfirmTimer);
    assert.ok(entry, 'a timer should be armed');
    assert.equal(entry.delay, 3000, 'delay must be exactly 3 seconds');
});

t('the timer fires the callback and clears its own id', () => {
    const { ctx, scheduled } = buildCtx();
    let fired = 0;
    ctx.scheduleAutoConfirm(() => fired++);
    scheduled.get(ctx.autoConfirmTimer).cb();
    assert.equal(fired, 1, 'callback should fire');
    assert.equal(ctx.autoConfirmTimer, null, 'timer id should be cleared after firing');
});

t('clearAutoConfirm cancels a pending fire (deselect case)', () => {
    const { ctx, scheduled } = buildCtx();
    let fired = 0;
    ctx.scheduleAutoConfirm(() => fired++);
    const id = ctx.autoConfirmTimer;
    ctx.clearAutoConfirm();
    assert.equal(ctx.autoConfirmTimer, null, 'timer id should be nulled');
    assert.equal(scheduled.has(id), false, 'the timeout should be cancelled');
    assert.equal(fired, 0, 'callback must not fire after clear');
});

t('scheduling again replaces the previous timer (no double-fire)', () => {
    const { ctx, scheduled } = buildCtx();
    let fired = 0;
    ctx.scheduleAutoConfirm(() => fired++);
    const first = ctx.autoConfirmTimer;
    ctx.scheduleAutoConfirm(() => fired++);
    assert.equal(scheduled.has(first), false, 'the first timer should be cancelled');
    assert.equal(scheduled.size, 1, 'only one timer should remain armed');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
