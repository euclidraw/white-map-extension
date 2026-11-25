import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { REGION_PRESETS } from './catalog.js';
import { THEMATIC_PRESETS } from './data/gis-presets.js';
import { EXTENSION_ID, MAP_ASPECT_ID, STUDIO_PANEL_ID } from './manifest.js';
import { parseCustomGisInput, resolveMapSpec } from './model.js';
import { EXAMPLE_MAP_CSS, parseMapCss } from './print-style.js';

const h = React.createElement;

function readSelectedMap(world, selectedIds) {
  if (!world || !Array.isArray(selectedIds)) return null;
  for (const id of selectedIds) {
    const props = world.getCanonical?.(id, MAP_ASPECT_ID);
    if (props) return { id, props };
  }
  return null;
}

const boxStyle = {
  display: 'grid',
  gap: '6px',
  padding: '8px',
  borderRadius: '8px',
  border: '1px solid var(--alid-border-subtle, #e4e4e7)',
};

const btnStyle = (primary = false) => ({
  padding: '5px 8px',
  borderRadius: '6px',
  border: primary ? 'none' : '1px solid var(--alid-border-subtle, #d4d4d8)',
  background: primary ? 'var(--alid-accent, #008FF0)' : 'transparent',
  color: primary ? 'var(--alid-accent-contrast, #ffffff)' : 'inherit',
  fontSize: '11px',
  fontWeight: primary ? 600 : 500,
  cursor: 'pointer',
});

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '5px 7px',
  borderRadius: '5px',
  border: '1px solid var(--alid-border-subtle, #d4d4d8)',
  background: 'var(--alid-bg-surface, #ffffff)',
  color: 'inherit',
  fontSize: '11.5px',
};

/**
 * Focused Map Tab Panel:
 * Scalar properties (projection, center/scale, layers, legend/inset, colors, line style, 10m bake)
 * live natively in Alid's Props (Inspector) panel, and quick placement tools live in the floating
 * horizontal hover tooltip menubar above each map. This tab stays focused on templates, regional
 * library browsing, custom GIS import/layer management, and multiline --map-* CSS editing.
 */
export function WhiteMapStudioView({ context }) {
  const [tick, setTick] = useState(0);
  const [regionQuery, setRegionQuery] = useState('');
  const [cssDraft, setCssDraft] = useState('');
  const [gisName, setGisName] = useState('사용자 레이어');
  const [gisDraft, setGisDraft] = useState('name,lon,lat\n서울,126.98,37.56\n부산,129.07,35.18');
  const [gisPattern, setGisPattern] = useState('none');
  const [gisFill, setGisFill] = useState('#bdbdbd');
  const [gisMarker, setGisMarker] = useState('bullseye');
  const [gisDoubleLine, setGisDoubleLine] = useState(false);
  const [gisStatus, setGisStatus] = useState(null);
  const [hlLevel, setHlLevel] = useState('admin0');
  const [hlCodes, setHlCodes] = useState('410, 156, 392');
  const [hlLabel, setHlLabel] = useState('A 지역');

  useEffect(() => {
    if (!context) return undefined;
    const bump = () => setTick(v => v + 1);
    const offSel = context.onSelectionChange?.(bump);
    const offWorld = context.onWorldMutated?.(bump);
    return () => {
      offSel?.();
      offWorld?.();
    };
  }, [context]);

  const selected = useMemo(() => {
    void tick;
    const ids = context?.getSelectedIds?.() ?? [];
    return readSelectedMap(context?.world, ids);
  }, [context, tick]);

  const resolved = useMemo(
    () => (selected ? resolveMapSpec(selected.props) : null),
    [selected],
  );

  useEffect(() => {
    setCssDraft(selected?.props?.customCss ?? '');
  }, [selected?.id, selected?.props?.customCss]);

  const filteredRegions = useMemo(() => {
    const q = regionQuery.trim().toLowerCase();
    if (!q) return REGION_PRESETS;
    return REGION_PRESETS.filter(r =>
      r.nameKo.toLowerCase().includes(q)
      || r.nameEn.toLowerCase().includes(q)
      || r.id.toLowerCase().includes(q),
    );
  }, [regionQuery]);

  const cssCheck = parseMapCss(cssDraft);
  const exec = (cmd, args = {}) => context?.executeCommand?.(`${EXTENSION_ID}:${cmd}`, args);

  const handleApplyThematic = thematicId => {
    if (selected) {
      void exec('apply-preset', { entityId: selected.id, thematicId });
    } else {
      void exec('insert-map', { thematicId });
    }
  };

  const handleSelectRegion = regionId => {
    if (selected) {
      void exec('set-region', { entityId: selected.id, regionPreset: regionId });
    } else {
      void exec('insert-map', { regionPreset: regionId });
    }
  };

  const handleAddCustomGis = () => {
    if (!selected) return;
    const parsed = parseCustomGisInput(gisDraft);
    if (!parsed.ok) {
      setGisStatus({ ok: false, message: parsed.error });
      return;
    }
    void exec('add-custom-layer', {
      entityId: selected.id,
      layer: {
        id: `custom-${Date.now()}`,
        name: gisName.trim() || '커스텀 GIS',
        kind: parsed.kind,
        visible: true,
        showInLegend: true,
        style: {
          fill: gisFill,
          pattern: gisPattern,
          stroke: '#171717',
          strokeWidth: parsed.kind === 'line' ? (gisDoubleLine ? 3.2 : 1.5) : 1.3,
          doubleLine: gisDoubleLine,
          marker: gisMarker,
        },
        geojson: parsed.geojson,
      },
    });
    setGisStatus({ ok: true, message: `${parsed.count}개 피처(${parsed.kind})를 추가했습니다.` });
  };

  const handleAddHighlightGroup = () => {
    if (!selected) return;
    const codes = hlCodes.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (!codes.length) return;
    const nextHighlights = [
      ...(selected.props.highlights ?? []),
      { level: hlLevel, codes, fill: gisFill, pattern: gisPattern, legendLabel: hlLabel.trim() },
    ];
    void exec('update-style', {
      entityId: selected.id,
      highlights: nextHighlights,
      ...(hlLabel.trim() ? { showLegend: true, legend: { ...(selected.props.legend ?? {}), enabled: true } } : {}),
    });
  };

  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      padding: '12px',
      fontSize: '12px',
      lineHeight: 1.45,
      color: 'var(--alid-text, #18181b)',
    },
  },
  // Header
  h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
    h('div', null,
      h('div', { style: { fontWeight: 700, fontSize: '13px' } }, '수능 백지도'),
      h('div', { style: { color: 'var(--alid-text-muted, #71717a)', fontSize: '11px' } },
        selected
          ? `선택됨: ${resolved.region.nameKo} (${resolved.bakedDetail ? '10m 베이크' : '50m 오프라인'})`
          : '템플릿이나 지역을 선택해 캔버스에 추가하세요'),
    ),
    h('button', {
      type: 'button',
      onClick: () => void exec('insert-map', {}),
      style: btnStyle(true),
    }, '+ 새 백지도'),
  ),

  h('small', { style: { color: 'var(--alid-text-muted, #71717a)' } },
    '세부 레이어·좌표·색상 속성은 속성(Props) 패널에서, 라벨·마커·경로 배치는 지도 위 가로 툴바에서 바로 사용할 수 있습니다.'),

  // 1. 5 CSAT Thematic Templates
  h('div', { style: boxStyle },
    h('div', { style: { fontWeight: 600, fontSize: '11.5px' } }, '수능 백지도 예제 프리셋 (5종)'),
    h('div', { style: { display: 'grid', gap: '5px' } },
      ...THEMATIC_PRESETS.map(tp =>
        h('button', {
          key: tp.id,
          type: 'button',
          onClick: () => handleApplyThematic(tp.id),
          title: tp.summary,
          style: {
            textAlign: 'left',
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid var(--alid-border-subtle, #e4e4e7)',
            background: 'var(--alid-bg-surface, #ffffff)',
            color: 'inherit',
            cursor: 'pointer',
            display: 'grid',
            gap: '2px',
          },
        },
        h('span', { style: { fontWeight: 600, fontSize: '11.5px' } }, tp.name),
        h('span', { style: { fontSize: '10.5px', color: 'var(--alid-text-muted, #71717a)' } }, tp.summary)),
      ),
    ),
  ),

  // 2. 12 Regional Library Presets
  h('details', { style: boxStyle },
    h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } }, `지역 프리셋 라이브러리 (${REGION_PRESETS.length}종)`),
    h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
      h('input', {
        type: 'search',
        value: regionQuery,
        onChange: e => setRegionQuery(e.target.value),
        placeholder: '지역 검색 (예: 한반도, 동북3성, 유럽, 페마른…)',
        style: inputStyle,
      }),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '5px', maxHeight: '150px', overflowY: 'auto' } },
        ...filteredRegions.map(r => {
          const isActive = resolved?.regionPreset === r.id;
          return h('button', {
            key: r.id,
            type: 'button',
            onClick: () => handleSelectRegion(r.id),
            style: {
              textAlign: 'left',
              padding: '5px 7px',
              borderRadius: '6px',
              border: isActive ? '1.5px solid var(--alid-accent, #008FF0)' : '1px solid var(--alid-border-subtle, #e4e4e7)',
              background: isActive ? 'var(--alid-accent-soft, #e5f4fe)' : 'var(--alid-bg-surface, #ffffff)',
              color: 'inherit',
              fontSize: '11px',
              cursor: 'pointer',
            },
          }, r.nameKo);
        }),
      ),
    ),
  ),

  // 3. Selected-map rich GIS, Highlights/Annotations list, and Multiline CSS
  selected && resolved
    ? h(React.Fragment, null,
      h('details', { open: true, style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } }, '커스텀 GIS 임포트 · 레이어 관리'),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
          h('input', { value: gisName, onChange: e => setGisName(e.target.value), placeholder: '레이어/범례 이름', style: inputStyle }),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } },
            h('select', { value: gisPattern, onChange: e => setGisPattern(e.target.value), style: inputStyle },
              h('option', { value: 'none' }, '단색 채움'),
              h('option', { value: 'hatch' }, '사선 빗금'),
              h('option', { value: 'crosshatch' }, '교차 빗금'),
              h('option', { value: 'stipple' }, '점묘 (Stipple)'),
            ),
            h('select', { value: gisMarker, onChange: e => setGisMarker(e.target.value), style: inputStyle },
              h('option', { value: 'bullseye' }, '수도 이중원 ◎'),
              h('option', { value: 'ring' }, '도넛 원 ○'),
              h('option', { value: 'dot' }, '채운 점 ●'),
              h('option', { value: 'square' }, '사각형 □'),
              h('option', { value: 'triangle' }, '삼각형 △'),
            ),
          ),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('input', { type: 'color', value: gisFill, onChange: e => setGisFill(e.target.value) }),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
              h('input', { type: 'checkbox', checked: gisDoubleLine, onChange: e => setGisDoubleLine(e.target.checked) }),
              h('span', null, '경로 이중선'),
            ),
          ),
          h('textarea', {
            rows: 4,
            value: gisDraft,
            onChange: e => setGisDraft(e.target.value),
            spellCheck: false,
            style: { ...inputStyle, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '10.5px' },
          }),
          gisStatus && h('small', { style: { color: gisStatus.ok ? '#16a34a' : '#dc2626' } }, gisStatus.message),
          h('button', { type: 'button', onClick: handleAddCustomGis, style: btnStyle(true) }, 'GeoJSON / TopoJSON / CSV 추가'),

          resolved.customLayers.length > 0 && h('div', { style: { display: 'grid', gap: '4px', marginTop: '4px' } },
            ...resolved.customLayers.map(layer =>
              h('div', { key: layer.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' } },
                h('span', null, `${layer.name} (${layer.kind})`),
                h('button', {
                  type: 'button',
                  onClick: () => void exec('remove-custom-layer', { entityId: selected.id, layerId: layer.id }),
                  style: btnStyle(false),
                }, '삭제'),
              ),
            ),
          ),
        ),
      ),

      h('details', { style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } },
          `강조 그룹 (${resolved.highlights.length}) · 지시선 라벨 (${resolved.annotations.length})`),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } },
            h('select', { value: hlLevel, onChange: e => setHlLevel(e.target.value), style: inputStyle },
              h('option', { value: 'admin0' }, '국가 (ISO 숫자)'),
              h('option', { value: 'admin1' }, '성·도 (CN-HL…)'),
            ),
            h('input', { value: hlLabel, onChange: e => setHlLabel(e.target.value), placeholder: '범례 이름', style: inputStyle }),
          ),
          h('input', { value: hlCodes, onChange: e => setHlCodes(e.target.value), placeholder: '410, 156, 392', style: inputStyle }),
          h('button', { type: 'button', onClick: handleAddHighlightGroup, style: btnStyle(false) }, '코드 강조 그룹 추가'),

          ...resolved.highlights.map((hl, idx) =>
            h('div', { key: `hl-${idx}`, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' } },
              h('span', null, `${hl.legendLabel || hl.level}: ${hl.codes.join(', ')}`),
              h('button', {
                type: 'button',
                onClick: () => void exec('remove-highlight', { entityId: selected.id, index: idx }),
                style: btnStyle(false),
              }, '삭제'),
            ),
          ),

          ...resolved.annotations.map(ann =>
            h('div', { key: ann.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' } },
              h('span', null, `라벨: ${ann.text}`),
              h('button', {
                type: 'button',
                onClick: () => void exec('remove-annotation', { entityId: selected.id, annotationId: ann.id }),
                style: btnStyle(false),
              }, '삭제'),
            ),
          ),
        ),
      ),

      h('details', { style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } }, '고급 사용자 CSS (--map-*)'),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
          h('textarea', {
            rows: 5,
            maxLength: 2048,
            value: cssDraft,
            spellCheck: false,
            placeholder: EXAMPLE_MAP_CSS,
            onChange: e => setCssDraft(e.target.value),
            style: { ...inputStyle, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '10.5px' },
          }),
          cssCheck.error && h('small', { role: 'alert', style: { color: '#dc2626' } }, cssCheck.error),
          h('div', { style: { display: 'flex', gap: '5px' } },
            h('button', { type: 'button', onClick: () => setCssDraft(EXAMPLE_MAP_CSS), style: btnStyle(false) }, '예시 입력'),
            h('button', {
              type: 'button',
              disabled: Boolean(cssCheck.error) || cssDraft === (selected.props.customCss ?? ''),
              onClick: () => void exec('update-style', { entityId: selected.id, customCss: cssDraft }),
              style: btnStyle(true),
            }, 'CSS 적용'),
            h('button', {
              type: 'button',
              onClick: () => {
                setCssDraft('');
                void exec('update-style', { entityId: selected.id, customCss: '' });
              },
              style: btnStyle(false),
            }, '초기화'),
          ),
        ),
      ),
    )
    : null,
  );
}

export function createStudioPanelSpec() {
  return {
    panelId: STUDIO_PANEL_ID,
    title: '수능 백지도',
    icon: {
      paths: [
        'M3 5l5-2 6 2 5-2v12l-5 2-6-2-5 2V5z',
        'M8 3v12',
        'M14 5v12',
      ],
    },
    defaultZone: 'right',
    isolation: 'container',
    navigation: {
      group: 'document',
      order: 46,
    },
    mount(hostEl, context) {
      if (!hostEl) return () => {};
      const doc = hostEl.ownerDocument;
      if (!doc || typeof doc.createElement !== 'function') {
        hostEl.textContent = '수능 백지도';
        return () => { hostEl.textContent = ''; };
      }
      const root = createRoot(hostEl);
      root.render(h(WhiteMapStudioView, { context }));
      return () => {
        try { root.unmount(); } catch {}
      };
    },
  };
}
