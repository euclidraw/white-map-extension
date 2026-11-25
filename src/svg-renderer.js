import { geoGraticule10 } from 'd3-geo';
import { INSET_REGIONS } from './catalog.js';
import {
  bakedCoversBbox,
  computeViewportBbox,
  createGeoPath,
  createMapProjection,
  getOfflineBaseGis,
} from './gis-base.js';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, resolveMapSpec } from './model.js';

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '\uFFFD')
    .replace(/[&<>"']/g, ch => (
      ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&apos;'
    ));
}

function uidFragment(entityId) {
  return Array.from(String(entityId ?? 'map'), c => c.codePointAt(0).toString(16)).join('-') || 'map';
}

function estimateTextWidth(text, fontSize = 11.5) {
  let units = 0;
  for (const ch of String(text ?? '')) {
    units += /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u4E00-\u9FFF]/.test(ch) ? 0.98 : 0.56;
  }
  return Math.ceil(units * fontSize);
}

function resolveFillPaint(fill, pattern, uid) {
  if (pattern === 'hatch') return `url(#wm-hatch-${uid})`;
  if (pattern === 'crosshatch') return `url(#wm-crosshatch-${uid})`;
  if (pattern === 'stipple') return `url(#wm-stipple-${uid})`;
  return fill || '#bdbdbd';
}

function renderMarkerSvg(x, y, style, ink) {
  const stroke = escapeXml(style?.stroke || ink);
  const fill = escapeXml(style?.fill || '#ffffff');
  const sw = Number.isFinite(style?.strokeWidth) ? style.strokeWidth : 1.5;
  switch (style?.marker) {
    case 'ring':
      return `<circle cx="${x}" cy="${y}" r="5" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(2.4, sw)}"/>`;
    case 'bullseye':
      return (
        `<circle cx="${x}" cy="${y}" r="4.2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` +
        `<circle cx="${x}" cy="${y}" r="1.7" fill="${stroke}"/>`
      );
    case 'square':
      return `<rect x="${x - 3.8}" y="${y - 3.8}" width="7.6" height="7.6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    case 'triangle':
      return `<polygon points="${x},${y - 4.5} ${x - 4.2},${y + 3.5} ${x + 4.2},${y + 3.5}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    case 'dot':
    default:
      return `<circle cx="${x}" cy="${y}" r="3.4" fill="${stroke}" stroke="${fill}" stroke-width="0.9"/>`;
  }
}

function cornerOrigin(corner, frameW, frameH, boxW, boxH, margin = 0) {
  const x = corner.endsWith('r') ? frameW - boxW - margin : margin;
  const y = corner.startsWith('t') ? margin : frameH - boxH - margin;
  return { x: Math.round(x), y: Math.round(y) };
}

function renderInsetSvg(inset, mainBbox, frameW, frameH, style, base, uid) {
  if (!inset.enabled) return '';
  const cfg = INSET_REGIONS[inset.region] ?? INSET_REGIONS.world;
  const boxW = Math.max(84, Math.min(136, Math.round(frameW * 0.27)));
  const boxH = Math.max(62, Math.min(104, Math.round(frameH * 0.27)));
  const origin = cornerOrigin(inset.corner, frameW, frameH, boxW, boxH, 0);
  const ix = origin.x + inset.offset.x;
  const iy = origin.y + inset.offset.y;

  const insetProj = createMapProjection(cfg.projection, cfg, boxW, boxH);
  const insetPath = createGeoPath(insetProj);
  const landD = insetPath(base.land) || '';

  let extentRect = '';
  const [minLon, minLat, maxLon, maxLat] = mainBbox;
  const p1 = insetProj([minLon, maxLat]);
  const p2 = insetProj([maxLon, minLat]);
  if (p1 && p2 && Number.isFinite(p1[0]) && Number.isFinite(p2[0])) {
    const rx = Math.min(p1[0], p2[0]);
    const ry = Math.min(p1[1], p2[1]);
    const rw = Math.max(6, Math.abs(p2[0] - p1[0]));
    const rh = Math.max(6, Math.abs(p2[1] - p1[1]));
    extentRect = `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" fill="none" stroke="${escapeXml(style.ink)}" stroke-width="1"/>`;
  }

  const clipId = `wm-inset-clip-${uid}`;
  return (
    `<g data-map-drag="inset" transform="translate(${ix},${iy})">` +
    `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${boxW}" height="${boxH}"/></clipPath></defs>` +
    `<g clip-path="url(#${clipId})">` +
    `<rect x="0" y="0" width="${boxW}" height="${boxH}" fill="${escapeXml(style.ocean === '#ffffff' ? '#e5e5e5' : style.ocean)}"/>` +
    (landD ? `<path d="${landD}" fill="#ffffff" stroke="${escapeXml(style.coast)}" stroke-width="0.45"/>` : '') +
    extentRect +
    `</g>` +
    `<rect data-map-box-frame="true" x="0.5" y="0.5" width="${boxW - 1}" height="${boxH - 1}" fill="none" stroke="${escapeXml(style.ink)}" stroke-width="0.95"/>` +
    `</g>`
  );
}

function renderLegendSvg(legend, frameW, frameH, style, uid) {
  if (!legend.enabled || !legend.items.length) return '';
  const items = legend.items.slice(0, 8);
  const horizontal = items.length <= 3 && items.every(it => it.kind !== 'line' && String(it.label).length <= 6);
  const padX = 9;
  const padY = 6;
  const rowH = 19;
  const swatchW = 20;

  let boxW = 0;
  let boxH = 0;
  let entries = '';

  if (horizontal) {
    let cursorX = padX;
    boxH = 26;
    const parts = [];
    for (const item of items) {
      const label = String(item.label ?? '');
      const lw = estimateTextWidth(label, 12);
      const fill = resolveFillPaint(item.fill, item.pattern, uid);
      parts.push(
        `<rect x="${cursorX}" y="7" width="16" height="12" fill="${escapeXml(fill)}" stroke="${escapeXml(style.ink)}" stroke-width="0.85"/>` +
        `<text x="${cursorX + 21}" y="17" font-size="12" font-weight="500" fill="${escapeXml(style.ink)}">${escapeXml(label)}</text>`,
      );
      cursorX += 21 + lw + 12;
    }
    boxW = Math.max(54, cursorX - 12 + padX);
    entries = parts.join('');
  } else {
    let maxLabelW = 0;
    const parts = [];
    items.forEach((item, idx) => {
      const label = String(item.label ?? '');
      const lw = estimateTextWidth(label, 11.5);
      if (lw > maxLabelW) maxLabelW = lw;
      const cy = padY + idx * rowH + 9;
      let swatch = '';
      if (item.kind === 'line') {
        if (item.doubleLine) {
          swatch =
            `<line x1="${padX}" y1="${cy}" x2="${padX + swatchW}" y2="${cy}" stroke="${escapeXml(item.stroke || style.ink)}" stroke-width="3.2"/>` +
            `<line x1="${padX}" y1="${cy}" x2="${padX + swatchW}" y2="${cy}" stroke="#ffffff" stroke-width="1.3"/>`;
        } else {
          const dashAttr = item.dash && item.dash !== 'none' ? ` stroke-dasharray="${escapeXml(item.dash)}"` : '';
          swatch = `<line x1="${padX}" y1="${cy}" x2="${padX + swatchW}" y2="${cy}" stroke="${escapeXml(item.stroke || style.ink)}" stroke-width="${item.strokeWidth ?? 1.4}"${dashAttr}/>`;
        }
      } else if (item.kind === 'point') {
        swatch = renderMarkerSvg(padX + swatchW / 2, cy, item, style.ink);
      } else {
        const fill = resolveFillPaint(item.fill, item.pattern, uid);
        swatch = `<rect x="${padX}" y="${cy - 5.5}" width="${swatchW}" height="11" fill="${escapeXml(fill)}" stroke="${escapeXml(style.ink)}" stroke-width="0.85"/>`;
      }
      parts.push(
        swatch +
        `<text x="${padX + swatchW + 7}" y="${cy + 4}" font-size="11.5" font-weight="500" fill="${escapeXml(style.ink)}">${escapeXml(label)}</text>`,
      );
    });
    boxW = Math.max(66, padX * 2 + swatchW + 7 + maxLabelW);
    boxH = padY * 2 + items.length * rowH;
    entries = parts.join('');
  }

  const origin = cornerOrigin(legend.corner, frameW, frameH, boxW, boxH, 0);
  const lx = origin.x + legend.offset.x;
  const ly = origin.y + legend.offset.y;

  return (
    `<g data-map-drag="legend" transform="translate(${lx},${ly})">` +
    `<rect data-map-box-frame="true" x="0.5" y="0.5" width="${boxW - 1}" height="${boxH - 1}" fill="#ffffff" stroke="${escapeXml(style.ink)}" stroke-width="0.95"/>` +
    entries +
    `</g>`
  );
}

/**
 * Compiles a diagram.white-map.map entity into a pure, deterministic vector SVG <g> node.
 * Zero foreignObject, zero CSS variables, zero runtime network fetches.
 */
export function renderMapSvg(props, derived, entityId = 'white-map') {
  const geom = derived ?? {
    x: 0,
    y: 0,
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    rotation: 0,
  };
  const width = Math.max(160, Math.round(Number.isFinite(geom.width) ? geom.width : DEFAULT_MAP_WIDTH));
  const height = Math.max(120, Math.round(Number.isFinite(geom.height) ? geom.height : DEFAULT_MAP_HEIGHT));
  const x = Number.isFinite(geom.x) ? geom.x : 0;
  const y = Number.isFinite(geom.y) ? geom.y : 0;
  const rotationDeg = Number.isFinite(geom.rotation) ? (geom.rotation * 180) / Math.PI : 0;

  const resolved = resolveMapSpec(props);
  const { style, baseLayers, highlights, customLayers, annotations, inset, legend, title, bakedDetail } = resolved;
  const base = getOfflineBaseGis();
  const uid = uidFragment(entityId);

  const titleHeight = title ? 26 : 0;
  const pad = 4;
  const frameX = pad;
  const frameY = pad + titleHeight;
  const frameW = Math.max(120, width - pad * 2);
  const frameH = Math.max(96, height - pad * 2 - titleHeight);

  const projection = createMapProjection(resolved.projection, resolved.viewport, frameW, frameH);
  const pathGen = createGeoPath(projection);
  const mainBbox = computeViewportBbox(projection, frameW, frameH);
  const useBaked = Boolean(bakedDetail && bakedCoversBbox(bakedDetail, mainBbox));

  const landSource = useBaked ? bakedDetail.land : base.land;
  const countriesSource = useBaked && bakedDetail.countries?.features?.length ? bakedDetail.countries : base.countries;
  const bordersSource = useBaked && bakedDetail.borders ? bakedDetail.borders : base.borders;
  const riversSource = useBaked && bakedDetail.rivers?.features?.length ? bakedDetail.rivers : base.rivers;
  const lakesSource = useBaked && bakedDetail.lakes?.features?.length ? bakedDetail.lakes : base.lakes;
  const admin1Source = useBaked && bakedDetail.admin1?.features?.length ? bakedDetail.admin1 : base.admin1;

  // 1. Graticule
  let graticuleSvg = '';
  if (baseLayers.graticule === 'grid') {
    const gd = pathGen(geoGraticule10());
    if (gd) {
      const dashAttr = style.gridDash !== 'none' ? ` stroke-dasharray="${escapeXml(style.gridDash)}"` : '';
      graticuleSvg = `<path d="${gd}" fill="none" stroke="${escapeXml(style.border)}" stroke-width="0.45" opacity="0.65"${dashAttr}/>`;
    }
  }

  // 2. Land fill
  const landD = pathGen(landSource) || '';
  const landFillSvg = landD ? `<path data-map-layer="land" d="${landD}" fill="${escapeXml(style.land)}" stroke="none"/>` : '';

  // 3. Highlighted Admin-0 / Admin-1 polygons
  const highlightParts = [];
  for (const h of highlights) {
    const codeSet = new Set(h.codes.map(c => c.toUpperCase()));
    const src = h.level === 'admin1' ? admin1Source : countriesSource;
    const fillPaint = resolveFillPaint(h.fill, h.pattern, uid);
    for (const feat of src?.features ?? []) {
      const code = String(feat.properties?.code ?? feat.id ?? '').toUpperCase();
      if (!codeSet.has(code)) continue;
      const d = pathGen(feat);
      if (d) {
        highlightParts.push(`<path data-map-highlight="${escapeXml(code)}" d="${d}" fill="${escapeXml(fillPaint)}" stroke="none"/>`);
      }
    }
  }

  // 4. Custom polygon layers
  const customPolyParts = [];
  const customLineParts = [];
  const customPointParts = [];
  for (const layer of customLayers) {
    if (layer.visible === false) continue;
    const fc = layer.geojson;
    const features = fc?.type === 'FeatureCollection' ? fc.features : fc?.type === 'Feature' ? [fc] : [];
    const lStyle = layer.style ?? {};

    for (const feat of features) {
      const gType = feat?.geometry?.type || '';
      if (/Polygon/i.test(gType)) {
        const d = pathGen(feat);
        if (!d) continue;
        const fill = resolveFillPaint(lStyle.fill || style.highlight, lStyle.pattern || 'none', uid);
        const stroke = lStyle.stroke && lStyle.stroke !== 'none' ? lStyle.stroke : 'none';
        const sw = Number.isFinite(lStyle.strokeWidth) ? lStyle.strokeWidth : 0.7;
        customPolyParts.push(
          `<path data-custom-layer="${escapeXml(layer.id)}" d="${d}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}" stroke-linejoin="round"/>`,
        );
      } else if (/Line/i.test(gType)) {
        const d = pathGen(feat);
        if (!d) continue;
        const stroke = lStyle.stroke || style.ink;
        const sw = Number.isFinite(lStyle.strokeWidth) ? lStyle.strokeWidth : 1.5;
        if (lStyle.doubleLine) {
          customLineParts.push(
            `<path data-custom-layer="${escapeXml(layer.id)}" d="${d}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${Math.max(2.6, sw)}" stroke-linecap="round" stroke-linejoin="round"/>` +
            `<path data-custom-layer="${escapeXml(layer.id)}" d="${d}" fill="none" stroke="#ffffff" stroke-width="${Math.max(1.1, sw * 0.42)}" stroke-linecap="round" stroke-linejoin="round"/>`,
          );
        } else {
          const dashAttr = lStyle.dash && lStyle.dash !== 'none' ? ` stroke-dasharray="${escapeXml(lStyle.dash)}"` : '';
          customLineParts.push(
            `<path data-custom-layer="${escapeXml(layer.id)}" d="${d}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}/>`,
          );
        }
      } else if (/Point/i.test(gType)) {
        const coords = gType === 'MultiPoint' ? feat.geometry.coordinates : [feat.geometry.coordinates];
        for (const c of coords) {
          const pt = projection(c);
          if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
          if (pt[0] < -10 || pt[0] > frameW + 10 || pt[1] < -10 || pt[1] > frameH + 10) continue;
          customPointParts.push(renderMarkerSvg(Number(pt[0].toFixed(1)), Number(pt[1].toFixed(1)), lStyle, style.ink));
        }
      }
    }
  }

  // 5. Lakes & Rivers
  let lakesSvg = '';
  if (baseLayers.lakes && lakesSource) {
    const ld = pathGen(lakesSource);
    if (ld) {
      lakesSvg = `<path data-map-layer="lakes" d="${ld}" fill="${escapeXml(style.lake)}" stroke="${escapeXml(style.coast)}" stroke-width="${Math.max(0.45, style.coastWidth * 0.7).toFixed(2)}"/>`;
    }
  }
  let riversSvg = '';
  if (baseLayers.rivers && riversSource) {
    const rd = pathGen(riversSource);
    if (rd) {
      riversSvg = `<path data-map-layer="rivers" d="${rd}" fill="none" stroke="${escapeXml(style.river)}" stroke-width="${style.riverWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }

  // 6. Admin-1 dotted boundaries & Admin-0 dashed international borders & solid coastlines
  let admin1Svg = '';
  if (baseLayers.admin1 && admin1Source) {
    const ad = pathGen(admin1Source);
    if (ad) {
      const dashAttr = style.admin1Dash !== 'none' ? ` stroke-dasharray="${escapeXml(style.admin1Dash)}"` : '';
      admin1Svg = `<path data-map-layer="admin1" d="${ad}" fill="none" stroke="${escapeXml(style.admin1)}" stroke-width="${style.admin1Width}" stroke-linejoin="round"${dashAttr}/>`;
    }
  }

  let bordersSvg = '';
  if (baseLayers.borders && bordersSource) {
    const bd = pathGen(bordersSource);
    if (bd) {
      const dashAttr = style.borderDash !== 'none' ? ` stroke-dasharray="${escapeXml(style.borderDash)}"` : '';
      bordersSvg = `<path data-map-layer="borders" d="${bd}" fill="none" stroke="${escapeXml(style.border)}" stroke-width="${style.borderWidth}" stroke-linejoin="round"${dashAttr}/>`;
    }
  }

  let coastSvg = '';
  if (baseLayers.coastline && landD) {
    coastSvg = `<path data-map-layer="coastline" d="${landD}" fill="none" stroke="${escapeXml(style.coast)}" stroke-width="${style.coastWidth}" stroke-linejoin="round"/>`;
  }

  // 7. Annotations (leader lines + haloed labels, draggable)
  const annotationParts = [];
  for (const ann of annotations) {
    const pt = projection([ann.lon, ann.lat]);
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
    const ax = Number(pt[0].toFixed(1));
    const ay = Number(pt[1].toFixed(1));
    if (ax < -40 || ax > frameW + 40 || ay < -40 || ay > frameH + 40) continue;
    const lx = Number((ax + ann.dx).toFixed(1));
    const ly = Number((ay + ann.dy).toFixed(1));
    const anchor = ann.dx < -8 ? 'end' : ann.dx > 8 ? 'start' : 'middle';
    const leader = ann.leaderLine && (Math.abs(ann.dx) > 4 || Math.abs(ann.dy) > 4)
      ? `<line x1="${ax}" y1="${ay}" x2="${lx}" y2="${ly}" stroke="${escapeXml(style.ink)}" stroke-width="0.75"/>`
      : '';
    const halo = ann.halo
      ? `<text x="${lx}" y="${ly}" dy="0.35em" text-anchor="${anchor}" font-size="12" font-weight="500" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linejoin="round">${escapeXml(ann.text)}</text>`
      : '';
    annotationParts.push(
      `<g data-map-drag="annotation:${escapeXml(ann.id)}">` +
      leader + halo +
      `<text x="${lx}" y="${ly}" dy="0.35em" text-anchor="${anchor}" font-size="12" font-weight="500" fill="${escapeXml(style.ink)}">${escapeXml(ann.text)}</text>` +
      `</g>`,
    );
  }

  // 8. Equator / latitude tick marks on the neatline
  let tickSvg = '';
  if (['equator-left', 'equator-right', 'ticks'].includes(baseLayers.graticule)) {
    const eqLon = resolved.viewport.rotateLon ? -resolved.viewport.rotateLon : resolved.viewport.centerLon;
    const eqPt = projection([eqLon, 0]);
    if (eqPt && Number.isFinite(eqPt[1]) && eqPt[1] > 14 && eqPt[1] < frameH - 14) {
      const ey = Number(eqPt[1].toFixed(1));
      const onRight = baseLayers.graticule === 'equator-right';
      const x1 = onRight ? frameW : 0;
      const x2 = onRight ? frameW - 6 : 6;
      const tx = onRight ? frameW - 9 : 9;
      const anchor = onRight ? 'end' : 'start';
      tickSvg =
        `<g data-map-layer="equator-tick">` +
        `<line x1="${x1}" y1="${ey}" x2="${x2}" y2="${ey}" stroke="${escapeXml(style.ink)}" stroke-width="0.9"/>` +
        `<text x="${tx}" y="${ey}" dy="0.35em" text-anchor="${anchor}" font-size="13" font-weight="500" fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">0°</text>` +
        `<text x="${tx}" y="${ey}" dy="0.35em" text-anchor="${anchor}" font-size="13" font-weight="500" fill="${escapeXml(style.ink)}">0°</text>` +
        `</g>`;
    }
  }

  // 9. Inset locator map & boxed legend
  const insetSvg = renderInsetSvg(inset, mainBbox, frameW, frameH, style, base, uid);
  const legendSvg = renderLegendSvg(legend, frameW, frameH, style, uid);

  const clipId = `wm-clip-${uid}`;
  const defsSvg =
    `<defs>` +
    `<clipPath id="${clipId}"><rect x="0" y="0" width="${frameW}" height="${frameH}"/></clipPath>` +
    `<pattern id="wm-hatch-${uid}" patternUnits="userSpaceOnUse" width="6" height="6">` +
    `<rect width="6" height="6" fill="#ffffff"/>` +
    `<path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" fill="none" stroke="${escapeXml(style.ink)}" stroke-width="0.85"/>` +
    `</pattern>` +
    `<pattern id="wm-crosshatch-${uid}" patternUnits="userSpaceOnUse" width="6" height="6">` +
    `<rect width="6" height="6" fill="#ffffff"/>` +
    `<path d="M0 6L6 0M0 0L6 6" fill="none" stroke="${escapeXml(style.ink)}" stroke-width="0.7"/>` +
    `</pattern>` +
    `<pattern id="wm-stipple-${uid}" patternUnits="userSpaceOnUse" width="5" height="5">` +
    `<rect width="5" height="5" fill="#d8d8d8"/>` +
    `<circle cx="1.4" cy="1.4" r="0.75" fill="${escapeXml(style.ink)}"/>` +
    `<circle cx="3.9" cy="3.9" r="0.65" fill="${escapeXml(style.ink)}"/>` +
    `</pattern>` +
    `</defs>`;

  const titleSvg = title
    ? `<text data-map-field="title" x="${width / 2}" y="20" text-anchor="middle" font-size="14" font-weight="700" fill="${escapeXml(style.ink)}">${escapeXml(title)}</text>`
    : '';

  const transformAttr = rotationDeg !== 0
    ? `translate(${x},${y}) rotate(${rotationDeg},${width / 2},${height / 2})`
    : `translate(${x},${y})`;

  const svg =
    `<g transform="${transformAttr}" data-white-map="true" data-map-region="${escapeXml(resolved.regionPreset)}" data-map-preset="${escapeXml(resolved.stylePreset)}" data-map-resolution="${useBaked ? '10m-baked' : '50m-offline'}" font-family="${escapeXml(style.fontFamily)}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
    titleSvg +
    `<g transform="translate(${frameX},${frameY})">` +
    defsSvg +
    `<g clip-path="url(#${clipId})">` +
    `<rect data-map-layer="ocean" x="0" y="0" width="${frameW}" height="${frameH}" fill="${escapeXml(style.ocean)}"/>` +
    `<g data-map-pan-layer="true">` +
    graticuleSvg +
    landFillSvg +
    highlightParts.join('') +
    customPolyParts.join('') +
    lakesSvg +
    riversSvg +
    admin1Svg +
    bordersSvg +
    coastSvg +
    customLineParts.join('') +
    customPointParts.join('') +
    annotationParts.join('') +
    `</g>` +
    tickSvg +
    insetSvg +
    legendSvg +
    `</g>` +
    `<rect data-map-neatline="true" x="0.5" y="0.5" width="${frameW - 1}" height="${frameH - 1}" fill="none" stroke="${escapeXml(style.ink)}" stroke-width="${style.frameWidth}"/>` +
    `</g>` +
    `</g>`;

  return {
    svg,
    meta: {
      bbox: mainBbox,
      useBaked,
      frameX,
      frameY,
      frameW,
      frameH,
      scale: resolved.viewport.scale,
    },
  };
}
