import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { REGION_PRESETS } from './catalog.js';
import { THEMATIC_PRESETS } from './data/gis-presets.js';
import { isDeepZoomScale } from './gis-base.js';
import { EXTENSION_ID, MAP_ASPECT_ID, STUDIO_PANEL_ID } from './manifest.js';
import { parseCustomGisInput, resolveMapSpec } from './model.js';
import { EXAMPLE_MAP_CSS, MAP_PRINT_PRESETS, parseMapCss } from './print-style.js';

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
  background: primary ? '#2563eb' : 'transparent',
  color: primary ? '#ffffff' : 'inherit',
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

export function WhiteMapStudioView({ context }) {
  const [tick, setTick] = useState(0);
  const [cssDraft, setCssDraft] = useState('');
  const [gisName, setGisName] = useState('사용자 레이어');
  const [gisDraft, setGisDraft] = useState('name,lon,lat\n서울,126.98,37.56\n부산,129.07,35.18');
  const [gisPattern, setGisPattern] = useState('none');
  const [gisFill, setGisFill] = useState('#bdbdbd');
  const [gisMarker, setGisMarker] = useState('bullseye');
  const [gisDoubleLine, setGisDoubleLine] = useState(false);
  const [gisStatus, setGisStatus] = useState(null);
  const [bakeStatus, setBakeStatus] = useState(null);
  const [hlLevel, setHlLevel] = useState('admin0');
  const [hlCodes, setHlCodes] = useState('410, 156, 392');
  const [hlLabel, setHlLabel] = useState('A 지역');
  const [annText, setAnnText] = useState('서울');
  const [annLon, setAnnLon] = useState('126.98');
  const [annLat, setAnnLat] = useState('37.56');

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
    setBakeStatus(null);
  }, [selected?.id, selected?.props?.customCss]);

  const cssCheck = parseMapCss(cssDraft);

  const exec = (cmd, args = {}) => context?.executeCommand?.(`${EXTENSION_ID}:${cmd}`, args);

  const handleApplyThematic = thematicId => {
    if (selected) {
      void exec('apply-preset', { entityId: selected.id, thematicId });
    } else {
      void exec('insert-map', { thematicId });
    }
  };

  const handleBakeHighRes = async () => {
    if (!selected) return;
    setBakeStatus({ ok: true, message: '공개 GIS CDN에서 10m 정밀 경계를 가져와 베이크 중…' });
    try {
      const result = await exec('bake-high-res', { entityId: selected.id });
      if (result?.ok) {
        setBakeStatus({ ok: true, message: `10m 고해상도 스냅샷 베이크 완료 (${result.featureCount}개 피처)` });
      } else {
        setBakeStatus({ ok: false, message: result?.error || '고해상도 베이크에 실패했습니다.' });
      }
    } catch (error) {
      setBakeStatus({ ok: false, message: error instanceof Error ? error.message : String(error) });
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
      ...(hlLabel.trim() ? { legend: { ...(selected.props.legend ?? {}), enabled: true } } : {}),
    });
  };

  const handleAddAnnotation = () => {
    if (!selected) return;
    const lon = Number(annLon);
    const lat = Number(annLat);
    if (!annText.trim() || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
    void exec('add-annotation', {
      entityId: selected.id,
      annotation: {
        id: `ann-${Date.now()}`,
        lon,
        lat,
        text: annText.trim(),
        dx: 24,
        dy: -10,
        leaderLine: true,
        halo: true,
      },
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
      h('div', { style: { fontWeight: 700, fontSize: '13px' } }, '수능 백지도 스튜디오'),
      h('div', { style: { color: 'var(--alid-text-muted, #71717a)', fontSize: '11px' } },
        selected
          ? `선택됨: ${resolved.region.nameKo} (${resolved.bakedDetail ? '10m 베이크' : '50m 오프라인'})`
          : '예제 템플릿이나 새 백지도를 클릭해 캔버스에 추가하세요'),
    ),
    h('button', {
      type: 'button',
      onClick: () => void exec('insert-map', {}),
      style: btnStyle(true),
    }, '+ 새 백지도'),
  ),

  // 1. Curated CSAT 5 reference templates
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

  selected && resolved
    ? h(React.Fragment, null,
      // 2. Region, Exploration & 10m High-Res Bake
      h('div', { style: boxStyle },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('strong', { style: { fontSize: '11.5px' } }, '지역 · 투영 · 프레임 탐색'),
          h('button', {
            type: 'button',
            onClick: () => void exec('explore-map', { entityId: selected.id }),
            style: btnStyle(true),
          }, '프레임 탐색 (더블클릭)'),
        ),
        h('small', { style: { color: 'var(--alid-text-muted, #71717a)' } },
          '지도 안을 더블클릭하면 캔버스 줌·드래그를 가로채 지도 내부를 팬/줌합니다. 탐색 중 Shift+클릭으로 국가·행정구역 강조 토글, Esc로 완료.'),
        h('label', { style: { display: 'grid', gap: '3px' } },
          h('span', null, '지역 중심 프리셋'),
          h('select', {
            value: resolved.regionPreset,
            onChange: e => void exec('set-region', { entityId: selected.id, regionPreset: e.target.value }),
            style: inputStyle,
          }, ...REGION_PRESETS.map(r => h('option', { key: r.id, value: r.id }, r.nameKo))),
        ),
        h('label', { style: { display: 'grid', gap: '3px' } },
          h('span', null, '지도 투영법'),
          h('select', {
            value: resolved.projection,
            onChange: e => void exec('update-style', { entityId: selected.id, projection: e.target.value }),
            style: inputStyle,
          },
          h('option', { value: 'mercator' }, '메르카토르 (Mercator · 지역/상세)'),
          h('option', { value: 'naturalEarth1' }, '내추럴 어스 (Natural Earth · 세계 분포)'),
          h('option', { value: 'conicEqualArea' }, '원뿔 정적 도법 (Conic Equal-Area)'),
          h('option', { value: 'equirectangular' }, '정방형 도법 (Equirectangular)')),
        ),
        h('div', { style: { fontSize: '10.5px', color: 'var(--alid-text-muted, #71717a)', fontVariantNumeric: 'tabular-nums' } },
          `중심: ${resolved.viewport.centerLat.toFixed(2)}°N, ${resolved.viewport.centerLon.toFixed(2)}°E · 배율 ×${Math.round(resolved.viewport.scale)}`),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            onClick: handleBakeHighRes,
            style: btnStyle(isDeepZoomScale(resolved.viewport.scale) && !resolved.bakedDetail),
          }, resolved.bakedDetail ? '10m 고해상도 다시 베이크' : '10m 고해상도 CDN 베이크'),
          resolved.bakedDetail && h('button', {
            type: 'button',
            onClick: () => void exec('clear-baked', { entityId: selected.id }),
            style: btnStyle(false),
          }, '50m 오프라인 복원'),
          h('button', {
            type: 'button',
            onClick: () => void exec('reset-viewport', { entityId: selected.id }),
            style: btnStyle(false),
          }, '시점 초기화'),
        ),
        bakeStatus && h('small', { style: { color: bakeStatus.ok ? '#16a34a' : '#dc2626' } }, bakeStatus.message),
      ),

      // 3. Base Layers & Highlights
      h('details', { open: true, style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } }, '기본 레이어 · 국경 · 하천 · 인셋'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', marginTop: '6px' } },
          ...[
            ['coastline', '해안선 (실선)'],
            ['borders', '국경선 (파선)'],
            ['admin1', '성·도 경계 (점선)'],
            ['rivers', '하천'],
            ['lakes', '호수'],
          ].map(([key, label]) =>
            h('label', { key, style: { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked: Boolean(resolved.baseLayers[key]),
                onChange: () => void exec('toggle-layer', { entityId: selected.id, layer: key }),
              }),
              h('span', null, label),
            ),
          ),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: resolved.inset.enabled,
              onChange: e => void exec('update-style', { entityId: selected.id, inset: { ...resolved.inset, enabled: e.target.checked } }),
            }),
            h('span', null, '위치 소지도 인셋'),
          ),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: resolved.legend.enabled,
              onChange: e => void exec('update-style', { entityId: selected.id, legend: { ...resolved.legend, enabled: e.target.checked } }),
            }),
            h('span', null, '범례 박스'),
          ),
        ),
        h('label', { style: { display: 'grid', gap: '3px', marginTop: '6px' } },
          h('span', null, '적도 · 위경선 표시'),
          h('select', {
            value: resolved.baseLayers.graticule || 'none',
            onChange: e => void exec('update-style', {
              entityId: selected.id,
              baseLayers: { ...resolved.baseLayers, graticule: e.target.value },
            }),
            style: inputStyle,
          },
          h('option', { value: 'none' }, '표시 안 함'),
          h('option', { value: 'equator-left' }, '좌측 0° 적도 눈금'),
          h('option', { value: 'equator-right' }, '우측 0° 적도 눈금'),
          h('option', { value: 'grid' }, '10° 위경선 격자')),
        ),
      ),

      // 4. Custom GIS Mapping & Highlights & Annotations
      h('details', { style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } }, '커스텀 GIS 매핑 · 지역 강조 · 지시선 라벨'),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
          h('strong', { style: { fontSize: '11px' } }, 'GeoJSON / TopoJSON / CSV 레이어 추가'),
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
              h('span', null, '경로 이중선 (터널/철도)'),
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
          h('button', { type: 'button', onClick: handleAddCustomGis, style: btnStyle(true) }, 'GIS 레이어 추가'),

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

          h('hr', { style: { border: 'none', borderTop: '1px solid var(--alid-border-subtle, #e4e4e7)', margin: '4px 0' } }),
          h('strong', { style: { fontSize: '11px' } }, '국가 / 행정구역 코드 강조'),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } },
            h('select', { value: hlLevel, onChange: e => setHlLevel(e.target.value), style: inputStyle },
              h('option', { value: 'admin0' }, '국가 (ISO 숫자: 410, 156)'),
              h('option', { value: 'admin1' }, '성·도 (CN-HL, CN-JL)'),
            ),
            h('input', { value: hlLabel, onChange: e => setHlLabel(e.target.value), placeholder: '범례 이름', style: inputStyle }),
          ),
          h('input', { value: hlCodes, onChange: e => setHlCodes(e.target.value), placeholder: '410, 156, 392', style: inputStyle }),
          h('button', { type: 'button', onClick: handleAddHighlightGroup, style: btnStyle(false) }, '강조 그룹 추가'),

          h('hr', { style: { border: 'none', borderTop: '1px solid var(--alid-border-subtle, #e4e4e7)', margin: '4px 0' } }),
          h('strong', { style: { fontSize: '11px' } }, '지시선 라벨 추가'),
          h('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '4px' } },
            h('input', { value: annText, onChange: e => setAnnText(e.target.value), placeholder: '지명', style: inputStyle }),
            h('input', { value: annLon, onChange: e => setAnnLon(e.target.value), placeholder: '경도', style: inputStyle }),
            h('input', { value: annLat, onChange: e => setAnnLat(e.target.value), placeholder: '위도', style: inputStyle }),
          ),
          h('button', { type: 'button', onClick: handleAddAnnotation, style: btnStyle(false) }, '지시선 라벨 추가'),
        ),
      ),

      // 5. Print Style & Custom CSS
      h('details', { style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } }, '수능 인쇄 스타일 · 사용자 CSS'),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
          h('select', {
            value: resolved.stylePreset,
            onChange: e => void exec('update-style', { entityId: selected.id, stylePreset: e.target.value }),
            style: inputStyle,
          }, ...MAP_PRINT_PRESETS.map(p => h('option', { key: p.id, value: p.id }, p.name))),
          h('small', { style: { color: 'var(--alid-text-muted, #71717a)' } }, resolved.style.preset.note),
          h('textarea', {
            rows: 5,
            maxLength: 2048,
            value: cssDraft,
            spellCheck: false,
            placeholder: EXAMPLE_MAP_CSS,
            onChange: e => setCssDraft(e.target.value),
            style: { ...inputStyle, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '10.5px' },
          }),
          h('small', { style: { color: 'var(--alid-text-muted, #71717a)' } },
            '--map-ocean / land / ink / coast / border / admin1 / river / highlight (#rrggbb) · --map-*-width (0.3~4px) · --map-border-dash / admin1-dash (none 또는 5 3) · --map-font (serif|sans-serif)'),
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
    title: '수능 백지도 스튜디오',
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
        hostEl.textContent = '수능 백지도 스튜디오';
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
