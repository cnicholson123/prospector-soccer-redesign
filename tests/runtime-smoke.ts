import assert from 'node:assert/strict';
import admin from '../api/admin.js';
import render from '../api/render.js';

assert.equal(typeof admin, 'object');
assert.equal(typeof render, 'object');

const health = await admin.fetch(new Request('http://localhost:3000/api/admin/healthz'));
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true });

const home = await render.fetch(new Request('http://localhost:3000/?page=index'));
assert.equal(home.status, 200);
assert.match(home.headers.get('content-type') ?? '', /text\/html/);
assert.match(await home.text(), /Prospector Soccer Club/);

const login = await admin.fetch(new Request('http://localhost:3000/api/admin/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ username: process.env.ADMIN_BOOTSTRAP_USERNAME, password: 'incorrect-password' }),
}));
assert.equal(login.status, 401);
assert.equal(login.headers.get('set-cookie'), null);
console.log('Plain Node ESM PASS — health 200, render 200 HTML, wrong-password login 401');
