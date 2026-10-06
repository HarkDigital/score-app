import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../espn.js';
import { newsUrl, parseNews, newsAge, newsImage, mergeNews } from '../news.js';

// Trimmed from ESPN's news feeds on Oct 5 2026.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

test('news comes from the site API, a team\'s read deeper', () => {
  assert.equal(newsUrl(leagueById('nfl')), 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=30');
  const team = new URL(newsUrl(leagueById('ncaaf'), 2294));
  assert.equal(team.pathname, '/apis/site/v2/sports/football/college-football/news');
  assert.equal(team.searchParams.get('team'), '2294');
  assert.equal(team.searchParams.get('limit'), '50');
  assert.equal(new URL(newsUrl(leagueById('nfl'), 12, 25)).searchParams.get('limit'), '25');
});

test('league news: every article, newest first, with its kind, picture and link', () => {
  const { articles } = parseNews(fixture('nfl-news'));
  assert.equal(articles.length, 8);
  assert.ok(articles.every((a, i) => i === 0 || a.published <= articles[i - 1].published));
  const video = articles.find((a) => a.kind === 'Video');
  assert.ok(video);
  assert.match(articles[0].url, /^https:\/\/www\.espn\.com\//);
  assert.match(articles[0].image, /^https:\/\/a\.espncdn\.com\//);
  assert.ok(articles.every((a) => a.headline && a.published instanceof Date));
});

test('team news keeps articles about the team: it and at most one other side', () => {
  const all = fixture('nfl-news-team12').articles;
  const { articles } = parseNews(fixture('nfl-news-team12'), { teamId: '12' });
  // The feed's power rankings, fantasy and draft round-ups tag 10 to 32 teams.
  assert.equal(all.length, 14);
  assert.equal(articles.length, 5);
  assert.ok(articles.some((a) => /Thornton/.test(a.headline)));
  assert.ok(!articles.some((a) => /Power Rankings|draft order|Fantasy/i.test(a.headline)));
  // College tags each school twice (team and university) under one id: a
  // two-team preview or recap still counts.
  const iowa = parseNews(fixture('ncaaf-news-team2294'), { teamId: 2294 }).articles;
  assert.deepEqual(iowa.map((a) => a.kind).sort(), ['Preview', 'Recap', 'Video']);
  // Previews and recaps link over http; they're read over https.
  assert.equal(iowa.find((a) => a.kind === 'Recap').url, 'https://www.espn.com/ncf/recap?gameId=401858473');
});

test('articles without a headline or a web link are dropped, repeats kept once', () => {
  const base = { headline: 'A', links: { web: { href: 'https://www.espn.com/x' } }, published: '2026-10-05T12:00:00Z' };
  const { articles } = parseNews({ articles: [
    { ...base, id: 1 }, { ...base, id: 1 }, { ...base, id: 2, headline: '' },
    { ...base, id: 3, links: { mobile: { href: 'https://m.espn.com/x' } } }, { ...base, id: 4, type: 'Media', premium: true, images: [{ url: 'http://x/y.jpg' }] },
  ] });
  assert.deepEqual(articles.map((a) => [a.id, a.kind, a.premium, a.image]), [['1', '', false, null], ['4', 'Video', true, null]]);
  assert.deepEqual(parseNews(null), { articles: [] });
});

test('article ages read like a feed', () => {
  const now = new Date(2026, 9, 5, 18, 0);
  const ago = (minutes) => new Date(now - minutes * 60_000);
  assert.equal(newsAge(ago(0.5), now), 'Just now');
  assert.equal(newsAge(ago(12), now), '12m');
  assert.equal(newsAge(ago(3 * 60), now), '3h');
  assert.equal(newsAge(new Date(2026, 9, 4, 9, 0), now), 'Yesterday');
  assert.equal(newsAge(new Date(2026, 8, 24, 9, 0), now), new Date(2026, 8, 24).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  assert.equal(newsAge(null, now), '');
});

test('ESPN photos come through its resizer at the size shown; other images as they are', () => {
  assert.equal(newsImage('https://a.espncdn.com/photo/2026/1004/r1726104_600x400_3-2.jpg', 192, 128),
    'https://a.espncdn.com/combiner/i?img=/photo/2026/1004/r1726104_600x400_3-2.jpg&w=192&h=128&scale=crop&cquality=80');
  assert.equal(newsImage('https://a.espncdn.com/i/teamlogos/nfl/500/kc.png', 192, 128), 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png');
  assert.equal(newsImage(null, 192, 128), null);
});

test('My Teams news: every followed team\'s together, newest first, a shared story once', () => {
  const chiefs = { league: 'nfl', id: '12', abbr: 'KC' };
  const iowa = { league: 'ncaaf', id: '2294', abbr: 'IOWA' };
  const raiders = { league: 'nfl', id: '13', abbr: 'LV' };
  const kc = parseNews(fixture('nfl-news-team12'), { teamId: '12' }).articles;
  const ia = parseNews(fixture('ncaaf-news-team2294'), { teamId: 2294 }).articles;
  const merged = mergeNews([{ team: chiefs, articles: kc }, { team: iowa, articles: ia }]);
  assert.equal(merged.length, kc.length + ia.length);
  assert.ok(merged.every((a, i) => i === 0 || a.published <= merged[i - 1].published));
  assert.deepEqual(merged.find((a) => a.id === ia[0].id).teams, [iowa]);
  // Their game's story, in both teams' feeds: once, tagged with both.
  const game = kc[0];
  const both = mergeNews([{ team: chiefs, articles: [game] }, { team: raiders, articles: [game] }]);
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].teams, [chiefs, raiders]);
  assert.equal(mergeNews([{ team: chiefs, articles: kc }], 2).length, 2);
});
