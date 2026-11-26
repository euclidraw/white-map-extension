import {isDeepZoomScale} from './gis-base.js';
import {clearVectorTiles, fetchViewport, tilePlan} from './vector-tiles.js';

// One assembled viewport per tile range, shared by canvas and synchronous SVG export.
const entries = new Map(), pending = new Map(), listeners = new Set();
function notify() {
  const active = pending.size > 0;
  for (const fn of listeners) {
    try { fn(active); } catch {}
  }
}
export function isBakeLoading() { return pending.size > 0; }
export function subscribeBakeLoading(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const bakeKey = (bbox,scale) => isDeepZoomScale(scale) ? tilePlan(bbox,scale)?.key : null;
export function cachedBake(bbox,scale) { return entries.get(bakeKey(bbox,scale)) ?? null; }
export function loadBake(bbox,scale,_layers,fetcher) {
  const key=bakeKey(bbox,scale);
  if(!key)return Promise.reject(new Error('이 범위에서는 오프라인 지도를 사용합니다.'));
  if(entries.has(key))return Promise.resolve(entries.get(key));
  if(pending.has(key))return pending.get(key).promise;
  const controller=new AbortController();
  const promise=fetchViewport(tilePlan(bbox,scale),fetcher,controller.signal).then(detail=>{
    controller.signal.throwIfAborted();
    entries.set(key,detail);
    if(entries.size>3)entries.delete(entries.keys().next().value);
    return detail;
  }).finally(()=>{
    if(pending.get(key)?.controller===controller){
      pending.delete(key);
      notify();
    }
  });
  pending.set(key,{controller,promise});
  notify();
  return promise;
}
export function clearBakeSession(){
  for(const {controller} of pending.values())controller.abort();
  pending.clear();
  entries.clear();
  clearVectorTiles();
  notify();
}
