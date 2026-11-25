import {isDeepZoomScale} from './gis-base.js';

// Reserve the source line before requesting tiles: loading them must not change
// the projected footprint or the tile key. All sizes are in map-local units.
export const CREDIT_SIZE = 4.5;
export const CREDIT_BASELINE = CREDIT_SIZE + 1;
export function frameLayout(width,height,resolved,detailEnabled=resolved.bakeEnabled) {
  const pad=4, frameY=pad+(resolved.title ? 26 : 0);
  const footer=detailEnabled && isDeepZoomScale(resolved.viewport.scale) ? 7 : 0;
  return {frameX:pad, frameY, frameW:Math.max(120,width-2*pad), frameH:Math.max(64,height-frameY-pad-footer)};
}
