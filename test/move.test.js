import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movePlan, savedSettings, keepSettings, returnUrl, MOVED_KEY, MOVING_KEY } from '../move.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
  };
};

const base = { inApp: true, hostname: 'scores.phade.app', search: '' };

test('movePlan: only the apps, only on scores.phade.app, once', () => {
  assert.equal(movePlan({ ...base, storage: memory(), session: memory() }), 'fetch');
  assert.equal(movePlan({ ...base, inApp: false, storage: memory(), session: memory() }), 'none');
  assert.equal(movePlan({ ...base, hostname: 'harkdigital.github.io', storage: memory(), session: memory() }), 'none');
  assert.equal(movePlan({ ...base, storage: memory({ [MOVED_KEY]: '1' }), session: memory() }), 'none');
});

test('movePlan: back with ?moved= keeps it; back without (offline) carries on', () => {
  const session = memory({ [MOVING_KEY]: '1' });
  assert.equal(movePlan({ ...base, search: '?moved=%7B%7D', storage: memory(), session }), 'keep');
  assert.equal(movePlan({ ...base, storage: memory(), session }), 'none');
  // ?moved= that this launch didn't ask for is ignored.
  assert.equal(movePlan({ ...base, search: '?moved=%7B%7D', storage: memory(), session: memory() }), 'fetch');
});

test('savedSettings and keepSettings carry every scores. setting but the marks', () => {
  const old = memory({
    'scores.myTeams': '[{"league":"nfl","id":"12"}]',
    'scores.alertDelay': '30',
    'scores.account': '{"user":"user_1"}',
    'other.thing': 'x',
  });
  const json = savedSettings(old);
  assert.deepEqual(JSON.parse(json), { 'scores.myTeams': '[{"league":"nfl","id":"12"}]', 'scores.alertDelay': '30' });
  const here = memory({ 'scores.alertDelay': '60' });
  assert.deepEqual(keepSettings(here, json), ['scores.myTeams']);
  assert.equal(here.getItem('scores.alertDelay'), '60'); // set here already wins
  assert.equal(here.getItem(MOVED_KEY), '1');
});

test('keepSettings: garbage still marks the move done', () => {
  for (const bad of [null, '', 'nope', '[1]', '{"scores.x":5,"evil":"1","scores.account":"x"}']) {
    const here = memory();
    assert.deepEqual(keepSettings(here, bad), []);
    assert.deepEqual(here.dump(), { [MOVED_KEY]: '1' });
  }
});

test('returnUrl keeps the route', () => {
  const url = returnUrl('https://scores.phade.app', '{"scores.span":"week"}', '#/game/nfl/401');
  assert.equal(url, 'https://scores.phade.app/?moved=%7B%22scores.span%22%3A%22week%22%7D#/game/nfl/401');
  const back = new URL(url);
  assert.equal(back.searchParams.get('moved'), '{"scores.span":"week"}');
  assert.equal(back.hash, '#/game/nfl/401');
});
