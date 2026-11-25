import {bakedCoversBbox, isDeepZoomScale} from './gis-base.js';
import {bakeHighResSnapshot} from './gis-cdn.js';

// Only public atlas data, keyed by geographic coverage, never document contents.
// A single regional result is also shared between canvas, hit testing and SVG export.
const entries = [];
const pending = new Map();
let generation = 0;
const precision = scale => scale >= 5000 ? 3 : scale >= 2500 ? 2 : 1;
export function cachedBake(bbox, scale, layers) {
  if (!isDeepZoomScale(scale)) return null;
  return entries.find(e => e.precision >= precision(scale) && bakedCoversBbox(e,bbox) &&
    ['rivers','lakes','admin1'].every(k => !layers[k] || e[k])) ?? null;
}
export const bakeKey = (bbox,scale,layers) => JSON.stringify([bbox,precision(scale),!!layers.rivers,!!layers.lakes,!!layers.admin1]);
export function loadBake(bbox,scale,layers,fetcher) {
  if (!isDeepZoomScale(scale)) return Promise.reject(new Error('지도를 더 확대하세요.'));
  const hit = cachedBake(bbox,scale,layers);
  if (hit) return Promise.resolve(hit);
  const key = bakeKey(bbox,scale,layers);
  if (pending.has(key)) return pending.get(key).promise;
  const g = generation, controller = new AbortController();
  const promise = bakeHighResSnapshot({bbox,scale,layers,fetcher,signal:controller.signal}).then(detail => {
    if (g !== generation) throw new Error('베이크 취소');
    detail.precision = precision(scale);
    entries.unshift(detail);
    if (entries.length > 3) entries.pop();
    return detail;
  }).finally(() => { if (pending.get(key)?.controller === controller) pending.delete(key); });
  pending.set(key,{controller,promise});
  return promise;
}
export function clearBakeSession() {
  generation++;
  for (const {controller} of pending.values()) controller.abort();
  pending.clear(); entries.length = 0;
}
