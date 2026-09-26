import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dictionaries,
  readLanguage,
  saveLanguage,
  translate,
  LANGUAGE_STORAGE_KEY,
  type TranslationKey,
} from '../src/i18n';

test('both dictionaries cover the same messages and interpolation parameters', () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.de).sort());
  for (const key of Object.keys(dictionaries.en) as TranslationKey[]) {
    assert.ok(dictionaries.de[key].trim(), key);
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(placeholders(dictionaries.en[key]), placeholders(dictionaries.de[key]), key);
  }
});

test('counts, limits and charging messages interpolate in both languages', () => {
  assert.equal(translate('en', 'jelly.one', { count: 1 }), '1 jelly');
  assert.equal(translate('de', 'jelly.other', { count: 8 }), '8 Jellies');
  assert.equal(translate('en', 'bubble.one', { count: 1 }), '1 bubble in the air');
  assert.equal(translate('de', 'bubble.other', { count: 2 }), '2 Blasen in der Luft');
  assert.equal(translate('en', 'ball.other', { count: 2, limit: 6 }), '2 / 6 floating balls');
  assert.equal(translate('de', 'wood.one', { count: 1, limit: 18 }), '1 / 18 Holzstück');
  assert.equal(translate('de', 'wave.charge', { amount: 45 }), 'Aufladen 45%');
});

test('English is the default for missing, invalid, and inaccessible preferences', () => {
  for (const value of [null, '', 'fr', 'DE', 'en'])
    assert.equal(readLanguage({ getItem: () => value }), 'en');
  assert.equal(readLanguage({ getItem: () => 'de' }), 'de');
  assert.equal(
    readLanguage({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    'en',
  );
});

test('only report a saved language when storage confirms the write', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  assert.equal(saveLanguage('de', storage), true);
  assert.equal(data.get(LANGUAGE_STORAGE_KEY), 'de');
  assert.equal(saveLanguage('en', { getItem: () => 'de', setItem: () => {} }), false);
  assert.equal(
    saveLanguage('de', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    }),
    false,
  );
});
