import assert from 'node:assert/strict';
import { test } from 'node:test';

import { presetSocket, presetStation, uploadPage } from '../src/upload.ts';

const user = { name: '<b>x</b>', role: 'contributor' };

test('uploadPage: closed while sign-in is off, no script', () => {
  const out = uploadPage('pt', { user: null, enabled: false });
  assert.match(out, /ainda não está aberto/);
  assert.ok(!out.includes('/upload.js'));
  assert.ok(!out.includes('id="upload"'));
  assert.match(out, /<meta name="robots" content="noindex">/);
});

test('uploadPage: signed out gets the sign-in link back to this page', () => {
  const out = uploadPage('en', { user: null, enabled: true });
  assert.ok(out.includes('href="/auth/osm/login?next=%2Fen%2Fupload"'));
  assert.ok(!out.includes('/upload.js'));
});

test('uploadPage: signed in gets the form, the script and an escaped name', () => {
  const out = uploadPage('pt', { user, enabled: true });
  assert.ok(out.includes('<script type="module" src="/upload.js"></script>'));
  assert.ok(out.includes('<form id="upload" class="upload" hidden>'));
  assert.ok(out.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!out.includes('<b>x</b>'));
  // Both consents are required by the browser before the form submits.
  assert.match(out, /id="ok-privacy" name="ok_privacy" required/);
  assert.match(out, /id="ok-license" name="ok_license" required/);
});

test('uploadPage: the messages for the script are valid JSON that cannot close the script element', () => {
  const out = uploadPage('en', { user, enabled: true });
  const m = out.match(/<script type="application\/json" id="upload-msg">(.*?)<\/script>/s);
  assert.ok(m);
  assert.ok(!m[1].includes('<'));
  const msg = JSON.parse(m[1]);
  assert.equal(msg.lang, 'en');
  assert.equal(msg.host, 'pictures.ocarroeletrico.com');
  for (const key of ['gps', 'noGps', 'zonesCount', 'ready', 'chooseStation', 'notClean']) assert.equal(typeof msg[key], 'string', key);
});

test('uploadPage: pt and en carry the same script messages', () => {
  const keys = (lang: 'pt' | 'en') => {
    const out = uploadPage(lang, { user, enabled: true });
    return Object.keys(JSON.parse(out.match(/id="upload-msg">(.*?)<\/script>/s)![1])).sort();
  };
  assert.deepEqual(keys('pt'), keys('en'));
});

test('uploadPage: with uploads open the button sends and the page says so', () => {
  const closed = uploadPage('pt', { user, enabled: true });
  const open = uploadPage('pt', { user, enabled: true, sending: true });
  assert.match(closed, />Preparar a foto</);
  assert.match(closed, /Ainda em construção/);
  assert.match(open, />Enviar a foto</);
  assert.ok(!open.includes('Ainda em construção'));
  const msg = JSON.parse(open.match(/id="upload-msg">(.*?)<\/script>/s)![1]);
  assert.equal(msg.canSend, true);
  assert.equal(typeof msg.errors.daily_limit, 'string');
});

test('uploadPage: the Turnstile widget only while sending is open', () => {
  const user = { name: 'Ana', role: 'contributor' };
  const open = uploadPage('pt', { user, enabled: true, sending: true, sitekey: 'k"x' });
  assert.ok(open.includes('class="cf-turnstile" data-sitekey="k&quot;x" data-action="upload" data-language="pt-pt"'));
  assert.ok(open.includes('https://challenges.cloudflare.com/turnstile/v0/api.js'));
  const closed = uploadPage('en', { user, enabled: true, sending: false, sitekey: 'k' });
  assert.ok(!closed.includes('cf-turnstile') && !closed.includes('challenges.cloudflare.com'));
});

test('presetStation: keeps station ids and aliases, drops anything else', () => {
  assert.equal(presetStation('EZC-AMD-00051'), 'EZC-AMD-00051');
  assert.equal(presetStation(' ABT-00026 '), 'ABT-00026');
  assert.equal(presetStation('0001PL0002'), '0001PL0002');
  assert.equal(presetStation(null), null);
  assert.equal(presetStation(''), null);
  assert.equal(presetStation('"><script>'), null);
  assert.equal(presetStation('/x'), null);
  assert.equal(presetStation('a'.repeat(65)), null);
});

test('uploadPage: ?posto= reaches the script, the sign-in link and the language switch', () => {
  const out = uploadPage('pt', { user: null, enabled: true, station: 'ABT-00026' });
  assert.ok(out.includes('href="/auth/osm/login?next=%2Fenviar%3Fposto%3DABT-00026"'));
  assert.ok(out.includes('/en/upload?posto=ABT-00026'));
  const signed = uploadPage('en', { user, enabled: true, station: 'ABT-00026' });
  const m = signed.match(/<script type="application\/json" id="upload-msg">(.*?)<\/script>/s);
  assert.ok(m);
  assert.equal(JSON.parse(m[1]).station, 'ABT-00026');
  assert.equal(JSON.parse(uploadPage('en', { user, enabled: true }).match(/id="upload-msg">(.*?)<\/script>/s)![1]).station, null);
});

test('presetSocket: either EVSE form becomes the compact code, anything else is dropped', () => {
  assert.equal(presetSocket('PT*EZC*E*AMD*00051*1'), 'PTEZCEAMD000511');
  assert.equal(presetSocket('ptezceamd000511'), 'PTEZCEAMD000511');
  assert.equal(presetSocket('<script>'), null);
  assert.equal(presetSocket(null), null);
});

test('uploadPage: ?tomada= reaches the script, and the targets ask what the photo shows', () => {
  const page = uploadPage('pt', { user, enabled: true, sending: true, station: 'EZC-AMD-00051', socket: 'PTEZCEAMD000511' });
  assert.ok(page.includes('"presetSocket":"PTEZCEAMD000511"'));
  assert.ok(page.includes('O que mostra esta foto?'));
});
