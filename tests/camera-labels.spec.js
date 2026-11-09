import { test, expect } from './fixtures.js';
import { PerspectiveCamera, Vector3 } from 'three';
import { model } from '../src/skins/pegs.ts';
import { waitFrames } from './helpers.js';

for (const viewport of [{ width: 430, height: 932 }, { width: 932, height: 430 }])
  for (const zoom of [0.5, 3])
    test(`${viewport.width}x${viewport.height} at 15 degrees and ${zoom} zoom: signs clear the character envelope and each other`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(zoom => localStorage.setItem('jailbirds:camera', JSON.stringify({ zoom, turn: 180, tilt: 15 })), zoom);
      await page.goto('/');
      await waitFrames(page, 6);
      const m = await page.evaluate(() => ({
        player: window.__jailbirds.state().agents[0],
        camera: window.__jailbirds.drawn(),
        surface: document.querySelector('.surface').getBoundingClientRect().toJSON(),
        tags: [...document.querySelectorAll('.tag:not([hidden])')].map(e => ({ text: e.textContent, box: e.getBoundingClientRect().toJSON() })),
      }));
      // Project the model's conservative standing envelope independently in Node,
      // not via the overlay's protection test or the old single torso point.
      const camera = new PerspectiveCamera(34, m.surface.width / m.surface.height, 10, 4000);
      camera.position.fromArray(m.camera.eye);
      camera.lookAt(new Vector3().fromArray(m.camera.target));
      camera.updateMatrixWorld();
      const points = [];
      for (const x of [-model.height / 3, model.height / 3])
        for (const z of [-model.height / 3, model.height / 3])
          for (const h of [0, model.height + 2]) {
            const p = new Vector3(m.player.x + x, h, m.player.y + z).project(camera);
            points.push({ x: m.surface.x + (p.x + 1) * m.surface.width / 2, y: m.surface.y + (1 - p.y) * m.surface.height / 2 });
          }
      const body = {
        left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
        top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
      };
      const intersects = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      expect(m.tags.length).toBeGreaterThan(0);
      expect(m.tags.filter(t => intersects(t.box, body)).map(t => t.text), 'labels over the character').toEqual([]);
      const overlaps = [];
      for (let i = 0; i < m.tags.length; i++)
        for (let j = i + 1; j < m.tags.length; j++)
          if (intersects(m.tags[i].box, m.tags[j].box)) overlaps.push(`${m.tags[i].text} / ${m.tags[j].text}`);
      expect(overlaps, 'stacked labels').toEqual([]);
    });
