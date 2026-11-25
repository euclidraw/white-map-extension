import { cmuFontCss } from './fonts.js';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, resolveMapSpec } from './model.js';
import { renderMapSvg } from './svg-renderer.js';

const NS = 'http://www.w3.org/2000/svg';
const injectedDocs = new WeakSet();
const mountState = new WeakMap();

const ALLOWED_TAGS = new Set(
  'svg g defs clipPath mask pattern linearGradient radialGradient stop use path line rect circle ellipse polyline polygon text tspan title desc'.split(' '),
);
const ALLOWED_ATTRS = new Set((
  'id class viewBox preserveAspectRatio transform d points x y x1 x2 y1 y2 cx cy r rx ry dx dy width height ' +
  'fill stroke color opacity fill-opacity stroke-opacity fill-rule clip-rule stroke-width stroke-dasharray stroke-dashoffset ' +
  'stroke-linecap stroke-linejoin stroke-miterlimit clip-path mask shape-rendering ' +
  'text-anchor dominant-baseline font-family font-size font-weight font-style letter-spacing ' +
  'patternUnits patternContentUnits patternTransform clipPathUnits href aria-hidden ' +
  'data-white-map data-map-region data-map-preset data-map-resolution data-map-layer data-map-highlight ' +
  'data-custom-layer data-map-drag data-map-box-frame data-map-neatline data-map-field'
).split(' '));
const IRI_ATTRS = new Set(['fill', 'stroke', 'clip-path', 'mask']);

function ensureDocumentCss(doc) {
  if (!doc || typeof doc.createElement !== 'function' || injectedDocs.has(doc)) return;
  try {
    if (!doc.getElementById?.('white-map-extension-css')) {
      const style = doc.createElement('style');
      style.id = 'white-map-extension-css';
      style.textContent = [
        cmuFontCss,
        '[data-role="white-map-mount"] [data-map-drag] { cursor: grab; touch-action: none; user-select: none; }',
        '[data-role="white-map-mount"][data-map-exploring="true"] { cursor: grab; outline: 2px solid var(--alid-accent, #008FF0); outline-offset: -2px; }',
        '[data-role="white-map-mount"][data-map-exploring="true"] [data-map-drag] { cursor: inherit; pointer-events: none; }',
      ].join('\n');
      (doc.head ?? doc.documentElement)?.appendChild?.(style);
    }
    injectedDocs.add(doc);
  } catch {
    // Ignore read-only documents
  }
}

export function createVectorSvgNode(doc, innerMarkup, width, height, title) {
  const parser = new doc.defaultView.DOMParser();
  const parsed = parser.parseFromString(`<svg xmlns="${NS}">${innerMarkup}</svg>`, 'image/svg+xml');
  if (parsed.documentElement.namespaceURI !== NS || parsed.querySelector('parsererror')) {
    throw new Error('백지도 SVG를 파싱하지 못했습니다.');
  }
  for (const el of parsed.documentElement.querySelectorAll('*')) {
    if (!ALLOWED_TAGS.has(el.localName) || el.namespaceURI !== NS) {
      el.remove();
      continue;
    }
    for (const { name, value } of [...el.attributes]) {
      const validIri = /^(?:none|transparent|currentColor|#[\da-f]{3,8}|url\(#[\w.-]+\)|rgba?\([\d.,%\s]+\))$/i;
      if (
        !ALLOWED_ATTRS.has(name)
        || (name === 'href' && !/^#[\w.-]+$/.test(value))
        || (IRI_ATTRS.has(name) && !validIri.test(value))
      ) {
        el.removeAttribute(name);
      }
    }
  }
  const root = doc.importNode(parsed.documentElement, true);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', title || '수능 백지도');
  root.style.display = 'block';
  return root;
}

/**
 * Re-renders just the inner vector SVG inside an existing mount element (used during live explore pan/zoom).
 */
export function paintMountVector(mountEl, props, width, height, entityId) {
  const doc = mountEl?.ownerDocument;
  if (!doc) return null;
  const { svg, meta } = renderMapSvg(props, { x: 0, y: 0, width, height, rotation: 0 }, entityId);
  if (doc.defaultView?.DOMParser) {
    const svgNode = createVectorSvgNode(doc, svg, width, height, props?.title || '수능 백지도');
    mountEl.replaceChildren(svgNode);
  } else {
    mountEl.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="${NS}">${svg}</svg>`;
  }
  return meta;
}

/**
 * DOM island renderer for diagram.white-map.map.
 * Never mutates hostEl.style so Alid's CanvasViewport camera zoom & transform-origin stay intact.
 */
export function renderMapDom(hostEl, props, derived, entityId = 'white-map') {
  if (!hostEl) return () => {};
  const geom = derived ?? {
    x: 0,
    y: 0,
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    rotation: 0,
  };
  const width = Math.max(160, Math.round(Number.isFinite(geom.width) ? geom.width : DEFAULT_MAP_WIDTH));
  const height = Math.max(120, Math.round(Number.isFinite(geom.height) ? geom.height : DEFAULT_MAP_HEIGHT));
  const resolved = resolveMapSpec(props);

  if (hostEl.dataset) {
    hostEl.dataset.whiteMapEntity = entityId;
    hostEl.dataset.mapRegion = resolved.regionPreset;
    hostEl.dataset.mapPreset = resolved.stylePreset;
  }

  const doc = hostEl.ownerDocument;
  if (!doc || typeof doc.createElement !== 'function') {
    const { svg } = renderMapSvg(props, { ...geom, x: 0, y: 0, rotation: 0 }, entityId);
    hostEl.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="${NS}">${svg}</svg>`;
    const rendered = hostEl.firstChild;
    return () => {
      if (hostEl.firstChild === rendered) hostEl.innerHTML = '';
    };
  }

  ensureDocumentCss(doc);

  let mountEl = mountState.get(hostEl);
  if (!mountEl || !hostEl.contains?.(mountEl)) {
    mountEl = doc.createElement('div');
    mountEl.dataset.role = 'white-map-mount';
    hostEl.replaceChildren(mountEl);
    mountState.set(hostEl, mountEl);
  }
  mountEl.dataset.whiteMapId = entityId;
  mountEl.style.width = `${width}px`;
  mountEl.style.height = `${height}px`;
  mountEl.style.boxSizing = 'border-box';
  mountEl.style.position = 'relative';
  mountEl.style.overflow = 'hidden';
  mountEl.style.userSelect = 'none';

  // If the user is actively exploring this map frame, let the explorer keep owning live preview frames.
  if (mountEl.dataset.mapExploring !== 'true') {
    paintMountVector(mountEl, props, width, height, entityId);
  }

  return () => {
    if (mountEl && !hostEl.contains?.(mountEl)) {
      mountState.delete(hostEl);
    }
  };
}
