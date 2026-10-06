// Pieces shared by the scoreboard and the game and team pages: icons,
// fetching, team logos, empty states and formatting.

import { fallbackUrl } from './espn.js';
import { newsAge, newsImage } from './news.js';

const icon = (size, body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"${extra}>${body}</svg>`;
const stroke = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
const STAR_PATH = '<path fill="currentColor" d="M12 2.6l2.9 5.98 6.6.95-4.78 4.65 1.13 6.57L12 17.65l-5.9 3.1 1.13-6.57L2.5 9.53l6.6-.95z"/>';
export const ICONS = {
  // The field's ball: brown with white laces, like the Android card's.
  football: '<svg viewBox="0 0 24 14" aria-hidden="true"><ellipse cx="12" cy="7" rx="10.6" ry="5.8" fill="#8b4a2b" stroke="#fff" stroke-width="1.4"/><path d="M8.5 7h7M10 5.4v3.2M12 5.4v3.2M14 5.4v3.2" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/></svg>',
  star: icon(14, STAR_PATH),
  starSmall: icon(11, STAR_PATH),
  starLarge: icon(30, STAR_PATH),
  left: icon(16, stroke('M15 5l-7 7 7 7')),
  right: icon(16, stroke('M9 5l7 7-7 7')),
  down: icon(16, stroke('M5 9l7 7 7-7')),
  plus: icon(16, stroke('M12 5v14M5 12h14')),
  check: icon(16, stroke('M5 12.5l4.5 4.5L19 7.5')),
  calendar: icon(30, stroke('M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v4M16 3v4')),
  trophy: icon(30, stroke('M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4')),
  alert: icon(30, stroke('M12 8v5M12 16.5v.01M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z')),
  winner: '<svg viewBox="0 0 8 10" width="7" height="9" aria-hidden="true"><path d="M8 0v10L0 5z" fill="currentColor"/></svg>',
  back: icon(20, stroke('M15 5l-7 7 7 7')),
  refresh: icon(18, stroke('M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4')),
  lock: icon(20, stroke('M7.5 11V8a4.5 4.5 0 0 1 9 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z')),
  lockCheck: icon(20, stroke('M7.5 11V8a4.5 4.5 0 0 1 9 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM9 16l2 2 4-4')),
  bell: icon(16, stroke('M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0')),
  bellOff: icon(16, stroke('M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0M4 4l16 16')),
  ball: icon(14, '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5l3.8 2.7-1.4 4.5H9.6l-1.4-4.5z" fill="currentColor"/>'),
  redCard: '<svg viewBox="0 0 10 14" width="9" height="12" aria-hidden="true"><rect width="10" height="14" rx="1.5" fill="currentColor"/></svg>',
  news: icon(30, stroke('M5 5h11v14H6.5A1.5 1.5 0 0 1 5 17.5zM16 9h3v8.5a1.5 1.5 0 0 1-3 0M8 9h5M8 12.5h5M8 16h3')),
  clipboard: icon(30, stroke('M9 4h6v3H9zM7 5.5H5.5A1.5 1.5 0 0 0 4 7v12.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H17M8 12h8M8 16h5')),
};

export async function getJson(url) {
  try {
    return await fetchJson(url);
  } catch (err) {
    const retry = fallbackUrl(url);
    if (!retry) throw err;
    return fetchJson(retry);
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const TROUBLE = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED|FORFEIT|ABANDONED/;

// Spread, total and (soccer) the draw, with the book they come from.
export function oddsHtml(odds, league) {
  const items = [
    [league.homeFirst ? 'Line' : 'Spread', odds.spread],
    ['Total', odds.total],
    ['Draw', odds.draw],
  ].filter(([, value]) => value);
  if (!items.length) return '';
  return `
    <div class="game-odds">
      ${items.map(([label, value]) => `<span class="odd"><span class="odd-label">${label}</span>${esc(value)}</span>`).join('')}
      ${odds.provider ? `<span class="book">${esc(odds.provider)}</span>` : ''}
    </div>`;
}

// ESPN's logo, or Phade's fallback: the team's color with its abbreviation.
export const failedLogos = new Set();
// News photos that failed to load (ESPN lists some that are gone): left out.
export const failedImages = new Set();

// Puts new markup into an element, keeping every node that's already right.
// Live scores redraw every 5 seconds; rebuilding the markup made every logo a
// new <img>, which WebKit shows blank until it has decoded it, so the logos
// flashed. Nodes are matched by position and tag, so only what changed (a
// score, the clock) is touched. A box score group someone opened or closed
// stays that way.
export function patchHtml(el, html) {
  const next = document.createElement('template');
  next.innerHTML = html;
  patchChildren(el, next.content);
}

function patchChildren(el, next) {
  const before = [...el.childNodes];
  const after = [...next.childNodes];
  after.forEach((node, i) => {
    const old = before[i];
    if (!old) el.appendChild(node);
    else if (old.nodeType !== node.nodeType || old.nodeName !== node.nodeName) el.replaceChild(node, old);
    else if (node.nodeType === Node.ELEMENT_NODE) patchElement(old, node);
    else if (old.nodeValue !== node.nodeValue) old.nodeValue = node.nodeValue;
  });
  for (const extra of before.slice(after.length)) extra.remove();
}

function patchElement(el, next) {
  const keep = (name) => name === 'open' && el.tagName === 'DETAILS';
  for (const { name } of [...el.attributes]) if (!next.hasAttribute(name) && !keep(name)) el.removeAttribute(name);
  for (const { name, value } of [...next.attributes]) if (!keep(name) && el.getAttribute(name) !== value) el.setAttribute(name, value);
  patchChildren(el, next);
}

// A news list (news.js parseNews): the newest article as a lead with its
// picture and summary, the rest as rows with a thumbnail. Every article opens
// on ESPN (in the apps, the phone's browser).
export function newsHtml(articles, { empty = 'No news right now.' } = {}) {
  if (!articles.length) return emptyState({ icon: ICONS.news, title: 'No news yet', text: empty });
  // My Teams tags each story with the followed teams it's about.
  const meta = (a) => {
    const text = [newsAge(a.published), a.kind, a.premium ? 'ESPN+' : ''].filter(Boolean).map(esc).join(' · ');
    if (!a.teams?.length) return text;
    const teams = a.teams.map((t) => `<span class="news-team">${logoHtml(t, 16)}${esc(t.abbr || t.name)}</span>`).join('');
    return `${teams}${text ? `<span>${text}</span>` : ''}`;
  };
  const link = (a, cls, body) => `<a class="${cls}" href="${esc(a.url)}" target="_blank" rel="noopener">${body}</a>`;
  // At twice the size shown, for sharp phones.
  const photo = (a, w, h) => {
    const src = a.image && newsImage(a.image, w, h);
    return src && !failedImages.has(src) ? src : null;
  };
  const [lead, ...rest] = articles;
  const leadImage = photo(lead, 750, 500);
  const leadHtml = link(lead, 'card news-lead', `
    ${leadImage ? `<img class="news-lead-img news-photo" src="${esc(leadImage)}" alt="" loading="lazy" decoding="async">` : ''}
    <span class="news-body">
      <span class="news-headline">${esc(lead.headline)}</span>
      ${lead.description ? `<span class="news-desc">${esc(lead.description)}</span>` : ''}
      <span class="news-meta">${meta(lead)}</span>
    </span>`);
  const rows = rest.map((a) => link(a, 'news-row', `
    <span class="news-body">
      <span class="news-headline">${esc(a.headline)}</span>
      <span class="news-meta">${meta(a)}</span>
    </span>
    ${photo(a, 192, 128) ? `<img class="news-thumb news-photo" src="${esc(photo(a, 192, 128))}" alt="" width="96" height="64" loading="lazy" decoding="async">` : ''}`)).join('');
  return leadHtml + (rows ? `<div class="card news-list">${rows}</div>` : '');
}

export function logoHtml(team, size = 28) {
  const abbr = team.abbr || abbreviate(team.name);
  if (team.logo && !failedLogos.has(team.logo)) {
    return `<img class="logo" src="${esc(team.logo)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-abbr="${esc(abbr)}" data-color="${esc(team.color ?? '')}">`;
  }
  return fallbackLogo(abbr, team.color);
}

export function fallbackLogo(abbr, color) {
  const bg = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : '#374151';
  return `<span class="logo logo-fallback" style="background:${bg};color:${textOn(bg)}" aria-hidden="true">${esc(abbr)}</span>`;
}

// Phade's TeamLogo rule: "New York Yankees" → NYY, "Texas Rangers" → RAN.
function abbreviate(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
  return words[words.length - 1].slice(0, 3).toUpperCase();
}

export function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 186 ? '#0a0a0a' : '#ffffff';
}

export function emptyState({ icon: art, title, text, action = '', error = false }) {
  return `
    <div class="card empty${error ? ' error' : ''}">
      <div class="empty-icon">${art}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

export function errorState() {
  return emptyState({
    error: true,
    icon: ICONS.alert,
    title: "Couldn't reach ESPN",
    text: 'Check your connection. This retries on its own every 30 seconds.',
    action: '<button class="btn-primary" data-action="retry">Try again</button>',
  });
}

export function fullDate(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatClock(date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
