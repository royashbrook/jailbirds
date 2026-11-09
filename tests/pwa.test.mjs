import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateControl } from '../src/pwa.ts';

test('startup and simultaneous lifecycle signals share one probe; disposal aborts and removes triggers', async () => {
  const names = ['window', 'document', 'navigator', 'fetch', '__BUILD_ID__', 'clearInterval'];
  const saved = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const window = new EventTarget(), document = new EventTarget();
  let count = 0, aborted = 0, ready = 0, interval, delay;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = fn => { interval = fn; return 123; };
  window.clearInterval = id => { assert.equal(id, 123); interval = undefined; };
  document.hidden = false;
  const fetch = (url, { signal }) => {
    assert.equal(url, '/?update-probe');
    count++;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted++;
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  };
  for (const [name, value] of Object.entries({ window, document, navigator: {}, fetch, __BUILD_ID__: 'this-build', clearInterval: window.clearInterval }))
    Object.defineProperty(globalThis, name, { configurable: true, value });
  let control;
  try {
    window.setTimeout = (fn, ms) => { delay = ms; return setTimeout(fn, ms); };
    control = updateControl(() => ready++);
    assert.equal(count, 1);
    assert.equal(delay, 8000);
    const pending = control.check();
    assert.equal(control.check(), pending);
    for (const event of ['focus', 'pageshow', 'online']) window.dispatchEvent(new Event(event));
    document.dispatchEvent(new Event('visibilitychange'));
    interval();
    assert.equal(count, 1);
    control.dispose();
    assert.equal(aborted, 1);
    assert.equal(await pending, 'unreachable');
    assert.equal(aborted, 1);
    assert.equal(interval, undefined);
    for (const event of ['focus', 'pageshow', 'online']) window.dispatchEvent(new Event(event));
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(await control.check(), 'unreachable');
    assert.equal(count, 1);
    assert.equal(ready, 0);
  } finally {
    control?.dispose();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
