// Checks that every translation stays in step with the English dictionary. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EN } from '../public/i18n.js';
import KM from '../public/i18n-km.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

for (const [code, dict] of Object.entries({ km: KM })) {
  test(`${code}: same keys as English`, () => {
    assert.deepEqual(Object.keys(dict).filter((k) => !(k in EN)), [], 'keys English does not have');
    assert.deepEqual(Object.keys(EN).filter((k) => !(k in dict)), [], 'untranslated keys');
  });
  test(`${code}: placeholders kept, no markup`, () => {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.trim(), `${key} is empty`);
      assert.deepEqual(placeholders(value), placeholders(EN[key]), `${key} placeholders`);
      assert.doesNotMatch(value, /[<>]/, `${key} contains markup`);
      assert.doesNotMatch(value, /\u200b/, `${key} contains a zero-width space`);
    }
  });
}
