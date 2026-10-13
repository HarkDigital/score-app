import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sitePage } from '../site.js';

test('the App Store pages: privacy and support, with their stylesheet', () => {
  const privacy = sitePage('GET', '/privacy');
  assert.equal(privacy.type, 'text/html; charset=utf-8');
  assert.match(privacy.body.toString(), /<h1>Privacy policy<\/h1>/);
  assert.match(privacy.body.toString(), /support@phade\.app/);
  assert.match(sitePage('GET', '/support').body.toString(), /<h1>Support<\/h1>/);
  assert.equal(sitePage('GET', '/legal.css').type, 'text/css; charset=utf-8');
  // Each page's stylesheet and links are ones the server answers.
  for (const path of ['/privacy', '/support']) {
    const refs = [...sitePage('GET', path).body.toString().matchAll(/(?:href)="(\/[^"]*)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 2, path);
    for (const ref of refs) assert.ok(sitePage('GET', ref), `${path} links ${ref}`);
  }
  // No em dashes in user-facing text (CLAUDE.md).
  for (const path of ['/privacy', '/support']) assert.doesNotMatch(sitePage('GET', path).body.toString(), /—/);
});

test('the pages answer HEAD and a trailing slash, and nothing else', () => {
  assert.ok(sitePage('HEAD', '/privacy'));
  assert.ok(sitePage('GET', '/privacy/'));
  assert.equal(sitePage('POST', '/privacy'), null);
  assert.equal(sitePage('GET', '/privacy.html'), null);
  assert.equal(sitePage('GET', '/'), null);
  assert.equal(sitePage('GET', '/health'), null);
  assert.equal(sitePage('GET', '/v1/widget'), null);
});
