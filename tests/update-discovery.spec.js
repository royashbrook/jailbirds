import { test, expect } from './fixtures.js';
import { waitFrames } from './helpers.js';

// These are lifecycle-contract probes. They do not claim physical iOS suspension.
test.use({ serviceWorkers: 'block' });
const probe = url => url.searchParams.has('update-probe');
const newer = '<!doctype html><meta name="build" content="a-new-deployed-build">';

test('launch discovers a new build without a manual check or automatic reload', async ({ page }) => {
  await page.route(probe, route => route.fulfill({ contentType: 'text/html', body: newer }));
  await page.goto('/');
  await expect(page.locator('.update')).toBeVisible();
  const build = await page.locator('meta[name=build]').getAttribute('content');
  await waitFrames(page, 3);
  await expect(page.locator('meta[name=build]')).toHaveAttribute('content', build);
  await page.click('#about');
  const load = page.getByRole('button', { name: 'load new version', exact: true });
  await expect(load).toBeVisible();
  expect(await load.evaluate(e => {
    const r = e.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e;
  })).toBe(true);
});

for (const event of ['visibilitychange', 'pageshow', 'focus', 'online'])
  test(`${event} discovers a release after an initially current build`, async ({ page }) => {
    const same = await (await page.request.get('/')).text();
    let body = same, count = 0;
    await page.route(probe, route => {
      count++;
      return route.fulfill({ contentType: 'text/html', body });
    });
    const first = page.waitForResponse(r => probe(new URL(r.url())));
    await page.goto('/');
    await (await first).finished();
    await waitFrames(page, 3);
    expect(count).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.update')).toHaveCount(0);
    body = newer;
    await page.evaluate(event => {
      if (event === 'visibilitychange') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event(event));
      } else window.dispatchEvent(new Event(event));
    }, event);
    await expect(page.locator('.update')).toBeVisible();
  });

test('hidden timers do not probe, and a visible return checks immediately', async ({ page }) => {
  await page.clock.install();
  const same = await (await page.request.get('/')).text();
  let body = same, count = 0;
  await page.route(probe, route => {
    count++;
    return route.fulfill({ contentType: 'text/html', body });
  });
  const first = page.waitForResponse(r => probe(new URL(r.url())));
  await page.goto('/');
  await (await first).finished();
  await waitFrames(page, 3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = count;
  await page.clock.fastForward(120000);
  expect(count).toBe(before);
  body = newer;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.update')).toBeVisible();
});
