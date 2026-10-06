// League and team news from ESPN's news feed, which sends a CORS header like
// the scoreboard. As in espn.js, every assumption about the feed's shape
// lives here and is covered by tests.

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

// A team's feed is every article that tags the team, round-ups included, so
// it's read deeper and filtered (parseNews). limit: fewer per team when My
// Teams reads several at once.
export function newsUrl(league, teamId, limit = teamId ? 50 : 30) {
  const url = new URL(`${SITE_BASE}/${league.path}/news`);
  url.searchParams.set('limit', String(limit));
  if (teamId) url.searchParams.set('team', String(teamId));
  return url.toString();
}

// ESPN's article types, as the list labels them. HeadlineNews and Story are
// plain articles.
const KINDS = { Media: 'Video', Recap: 'Recap', Preview: 'Preview' };

// Articles as the app lists them, newest first: headline, summary, when,
// a thumbnail, the link to ESPN, and whether it's ESPN+.
// teamId: only articles about that team. ESPN's team feed also carries
// round-ups that tag half the league (power rankings, fantasy, the draft
// order), so an article counts when it tags this team and at most one other
// (a game's preview or recap tags both sides). College articles tag each
// school twice (team and university) under the same id.
export function parseNews(data, { teamId } = {}) {
  const seen = new Set();
  const articles = [];
  for (const a of Array.isArray(data?.articles) ? data.articles : []) {
    // Game previews and recaps link over plain http; ESPN serves them on
    // https too (and the apps load nothing else).
    const href = a?.links?.web?.href;
    const url = typeof href === 'string' ? href.replace(/^http:\/\//, 'https://') : '';
    if (!a?.headline || !url.startsWith('https://')) continue;
    const key = String(a.id ?? url);
    if (seen.has(key)) continue;
    if (teamId !== undefined) {
      const teams = new Set((a.categories ?? []).filter((c) => c?.type === 'team' && c.teamId).map((c) => String(c.teamId)));
      if (!teams.has(String(teamId)) || teams.size > 2) continue;
    }
    seen.add(key);
    const published = new Date(a.published ?? a.lastModified);
    const image = (a.images ?? []).find((i) => typeof i?.url === 'string' && i.url.startsWith('https://'));
    articles.push({
      id: key,
      headline: a.headline,
      description: a.description ?? '',
      kind: KINDS[a.type] ?? '',
      published: Number.isNaN(published.getTime()) ? null : published,
      image: image?.url ?? null,
      url,
      premium: a.premium === true,
    });
  }
  return { articles: articles.sort((x, y) => (y.published ?? 0) - (x.published ?? 0)) };
}

// My Teams: each followed team's news (parseNews with its teamId) together,
// newest first, each article tagged with the followed teams it's about. A
// story about two of them (their game) shows once, tagged with both.
export function mergeNews(feeds, limit = 40) {
  const byId = new Map();
  for (const { team, articles } of feeds) {
    for (const article of articles) {
      const seen = byId.get(article.id);
      if (!seen) byId.set(article.id, { ...article, teams: [team] });
      else if (!seen.teams.some((t) => t.league === team.league && t.id === team.id)) seen.teams.push(team);
    }
  }
  return [...byId.values()].sort((x, y) => (y.published ?? 0) - (x.published ?? 0)).slice(0, limit);
}

// An article photo at the size it's shown: ESPN's photos run up to 1920px
// wide, and its image resizer (combiner) crops one to size. Other images as
// they are.
export function newsImage(url, width, height) {
  const match = /^https:\/\/a\.espncdn\.com(\/photo\/[^?#]+)$/.exec(url ?? '');
  if (!match) return url ?? null;
  return `https://a.espncdn.com/combiner/i?img=${match[1]}&w=${width}&h=${height}&scale=crop&cquality=80`;
}

// "Just now", "12m", "3h", "Yesterday", then the date ("Sep 24").
export function newsAge(date, now = new Date()) {
  if (!date) return '';
  const minutes = Math.floor((now - date) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (Math.round((day(now) - day(date)) / 86_400_000) === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
