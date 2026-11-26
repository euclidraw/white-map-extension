import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BASE_CRS_LABEL } from './crs.js';
import districtNames from './data/kr-district-names.json' with { type: 'json' };
import { REGION_PRESETS } from './catalog.js';
import { THEMATIC_PRESETS } from './data/gis-presets.js';
import { EXTENSION_ID, MAP_ASPECT_ID, STUDIO_PANEL_ID } from './manifest.js';
import { parseCustomGisInput, resolveMapSpec } from './model.js';
import { EXAMPLE_MAP_CSS, parseMapCss } from './print-style.js';

const h = React.createElement;
const provinceNames = [...new Map(districtNames.map(([code, province]) => [code.slice(0, 2), [code.slice(0, 2), province, '']])).values()];

function readSelectedMap(world, selectedIds) {
  if (!world || !Array.isArray(selectedIds)) return null;
  for (const id of selectedIds) {
    const props = world.getCanonical?.(id, MAP_ASPECT_ID);
    if (props) return { id, props };
  }
  return null;
}

function hasUserEdits(resolved) {
  if (!resolved) return false;
  return Boolean(
    resolved.customLayers.length > 0
    || resolved.annotations.length > 0
    || resolved.highlights.length > 0
    || resolved.title.trim(),
  );
}

function safeHexColor(val, fallback = '#bdbdbd') {
  return typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val) ? val : fallback;
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

const compactInputStyle = {
  ...inputStyle,
  padding: '3px 6px',
  fontSize: '11px',
};

/**
 * IME-safe inline text input that commits on Enter or Blur as a single Undo step.
 */
function CommitTextInput({ value, placeholder, ariaLabel, allowEmpty = true, onCommit, style }) {
  const [draft, setDraft] = useState(value ?? '');
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) setDraft(value ?? '');
  }, [value]);

  const commit = raw => {
    const trimmed = raw.trim();
    if (!allowEmpty && !trimmed) {
      setDraft(value ?? '');
      return;
    }
    const next = allowEmpty ? trimmed : trimmed;
    if (next !== (value ?? '')) onCommit(next);
  };

  return h('input', {
    type: 'text',
    value: draft,
    placeholder,
    'aria-label': ariaLabel,
    style: style || compactInputStyle,
    onChange: e => setDraft(e.target.value),
    onCompositionStart: () => { composingRef.current = true; },
    onCompositionEnd: e => {
      composingRef.current = false;
      setDraft(e.currentTarget.value);
    },
    onBlur: e => {
      if (!composingRef.current) commit(e.currentTarget.value);
    },
    onKeyDown: e => {
      if (composingRef.current || e.nativeEvent?.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(e.currentTarget.value);
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setDraft(value ?? '');
        e.currentTarget.blur();
      }
    },
  });
}

/**
 * Focused Map Tab Panel:
 * Scalar properties live natively in Alid's Props (Inspector) panel, and quick placement tools live
 * in the top-fixed .stem-toolbar HUD. This tab manages CSAT templates (with overwrite protection),
 * regional search, file/text GIS import, inline editing of highlights/layers/labels, and --map-* CSS.
 */
export function WhiteMapStudioView({ context }) {
  const [tick, setTick] = useState(0);
  const [regionQuery, setRegionQuery] = useState('');
  const [pendingThematicId, setPendingThematicId] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [cssDraft, setCssDraft] = useState('');
  const [sourceCrs, setSourceCrs] = useState('auto');
  const [gisName, setGisName] = useState('사용자 레이어');
  const [gisDraft, setGisDraft] = useState('name,lon,lat\n서울,126.98,37.56\n부산,129.07,35.18');
  const [gisPattern, setGisPattern] = useState('none');
  const [gisFill, setGisFill] = useState('#bdbdbd');
  const [gisMarker, setGisMarker] = useState('bullseye');
  const [gisDoubleLine, setGisDoubleLine] = useState(false);
  const [gisStatus, setGisStatus] = useState(null);
  const [hlLevel, setHlLevel] = useState('admin0');
  const [hlCodes, setHlCodes] = useState('410, 156, 392');
  const [districtQuery, setDistrictQuery] = useState('');
  const koreanNames = hlLevel === 'kr-sido' ? provinceNames : hlLevel === 'kr-sgg' ? districtNames : null;
  const unit = hlLevel === 'kr-sido' ? '시·도' : '시·군·구';
  const [hlLabel, setHlLabel] = useState('A 지역');
  const fileInputRef = useRef(null);

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
    setPendingThematicId(null);
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
    if (!selected) {
      void exec('insert-map', { thematicId });
      return;
    }
    if (hasUserEdits(resolved)) {
      setPendingThematicId(thematicId);
      return;
    }
    void exec('apply-preset', { entityId: selected.id, thematicId });
  };

  const handleSelectRegion = regionId => {
    if (selected) {
      void exec('set-region', { entityId: selected.id, regionPreset: regionId });
    } else {
      void exec('insert-map', { regionPreset: regionId });
    }
  };

  const commitGisLayer = (rawText, layerName) => {
    if (!selected) return;
    const parsed = parseCustomGisInput(rawText, sourceCrs);
    if (!parsed.ok) {
      setGisStatus({ ok: false, message: parsed.error });
      return;
    }
    void exec('add-custom-layer', {
      entityId: selected.id,
      layer: {
        id: `custom-${Date.now()}`,
        name: (layerName ?? gisName).trim() || '커스텀 GIS',
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
    setGisStatus({ ok: true, message: `${parsed.count}개 피처 추가 · 원본 ${parsed.sourceCrs} → 저장 EPSG:4326` });
  };

  const handleAddCustomGis = () => commitGisLayer(gisDraft, gisName);

  const handleFileObject = async file => {
    if (!file) return;
    try {
      const textContent = await file.text();
      const baseName = String(file.name || '').replace(/\.(?:geo|topo)?json$|\.(?:csv|tsv|txt)$/i, '').trim() || '파일 레이어';
      setGisDraft(textContent);
      setGisName(baseName);
      commitGisLayer(textContent, baseName);
    } catch (error) {
      setGisStatus({ ok: false, message: `파일 읽기 실패: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const handleAddHighlightGroup = () => {
    if (!selected) return;
    const codes = hlCodes.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (!codes.length || (koreanNames && codes.some(c => !koreanNames.some(([code]) => code === c)))) return;
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

  const pendingPreset = pendingThematicId
    ? THEMATIC_PRESETS.find(tp => tp.id === pendingThematicId) ?? null
    : null;

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
          ? `선택됨: ${resolved.region.nameKo} (${resolved.bakeEnabled ? '자동 상세화 켜짐' : '50m 오프라인'})`
          : '템플릿이나 지역을 선택해 캔버스에 추가하세요'),
    ),
    h('button', {
      type: 'button',
      onClick: () => void exec('insert-map', {}),
      style: btnStyle(true),
    }, '+ 새 백지도'),
  ),

  h('small', { style: { color: 'var(--alid-text-muted, #71717a)' } },
    '세부 레이어·좌표·색상 속성은 속성(Props) 패널에서, 라벨·마커·경로·영역 배치는 지도 위 상단 툴바에서 바로 사용할 수 있습니다.'),

  // 1. 5 CSAT Thematic Templates (with overwrite guard)
  h('div', { style: boxStyle },
    h('div', { style: { fontWeight: 600, fontSize: '11.5px' } }, '수능 백지도 예제 프리셋 (5종)'),
    pendingPreset && h('div', {
      'data-wm-preset-confirm': 'true',
      style: {
        display: 'grid',
        gap: '6px',
        padding: '7px 8px',
        borderRadius: '6px',
        border: '1px solid var(--alid-accent, #008FF0)',
        background: 'var(--alid-accent-soft, #eff6ff)',
        fontSize: '11px',
      },
    },
    h('span', null, `‘${pendingPreset.name}’ 예제를 어떻게 적용할까요? (현재 지도에 작업 내역이 있습니다)`),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px' } },
      h('button', {
        type: 'button',
        'data-wm-confirm-insert': 'true',
        onClick: () => {
          void exec('insert-map', { thematicId: pendingPreset.id });
          setPendingThematicId(null);
        },
        style: btnStyle(true),
      }, '새 백지도로 추가'),
      h('button', {
        type: 'button',
        'data-wm-confirm-overwrite': 'true',
        onClick: () => {
          if (selected) void exec('apply-preset', { entityId: selected.id, thematicId: pendingPreset.id });
          setPendingThematicId(null);
        },
        style: btnStyle(false),
      }, '현재 지도에 덮어쓰기'),
      h('button', {
        type: 'button',
        onClick: () => setPendingThematicId(null),
        style: btnStyle(false),
      }, '취소'),
    )),
    h('div', { style: { display: 'grid', gap: '5px' } },
      ...THEMATIC_PRESETS.map(tp =>
        h('button', {
          key: tp.id,
          type: 'button',
          'data-wm-thematic-btn': tp.id,
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

  // 3. Selected-map rich GIS, Highlights/Annotations inline editors, and Multiline CSS
  selected && resolved
    ? h(React.Fragment, null,
      h('details', { open: true, style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } }, '커스텀 GIS 임포트 · 레이어 관리'),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
          h('small', null, '기준 좌표계: ' + BASE_CRS_LABEL + '. 투영법은 화면 표시만 바꿉니다.'),
          h('label', null, '원본 좌표계', h('select', { value: sourceCrs, onChange: e => setSourceCrs(e.target.value), style: inputStyle },
            h('option', { value: 'auto' }, '자동 · 선언이 없으면 WGS 84'),
            h('option', { value: 'EPSG:4326' }, 'WGS 84 · 경도, 위도 (°)'),
            h('option', { value: 'EPSG:5179' }, 'Korea 2000 / 통합좌표계 · 동쪽 X, 북쪽 Y (m)'))),

          // File Drag & Drop + File Picker
          h('div', {
            'data-wm-gis-dropzone': 'true',
            onDragOver: e => { e.preventDefault(); setDropActive(true); },
            onDragLeave: () => setDropActive(false),
            onDrop: e => {
              e.preventDefault();
              setDropActive(false);
              const file = e.dataTransfer?.files?.[0];
              if (file) void handleFileObject(file);
            },
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              padding: '6px 8px',
              borderRadius: '6px',
              border: dropActive ? '1.5px dashed var(--alid-accent, #008FF0)' : '1px dashed var(--alid-border-subtle, #d4d4d8)',
              background: dropActive ? 'var(--alid-accent-soft, #eff6ff)' : 'transparent',
              fontSize: '11px',
            },
          },
          h('span', { style: { color: 'var(--alid-text-muted, #71717a)' } }, '.geojson · .topojson · .csv 드롭'),
          h('input', {
            ref: fileInputRef,
            type: 'file',
            accept: '.geojson,.json,.topojson,.csv,.tsv,.txt',
            'aria-label': 'GIS 파일 불러오기',
            style: { display: 'none' },
            onChange: e => {
              const file = e.currentTarget.files?.[0];
              if (file) void handleFileObject(file);
              e.currentTarget.value = '';
            },
          }),
          h('button', {
            type: 'button',
            onClick: () => fileInputRef.current?.click(),
            style: btnStyle(false),
          }, '파일 선택')),

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

          resolved.customLayers.length > 0 && h('div', { style: { display: 'grid', gap: '5px', marginTop: '4px' } },
            ...resolved.customLayers.map(layer => {
              const kind = layer.kind || 'polygon';
              const lineMode = layer.style?.doubleLine ? 'double' : (layer.style?.dash && layer.style.dash !== 'none' ? 'dashed' : 'solid');
              return h('div', {
                key: layer.id,
                'data-wm-layer-row': layer.id,
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto auto',
                  gap: '4px',
                  alignItems: 'center',
                  fontSize: '11px',
                },
              },
              h('input', {
                type: 'checkbox',
                'aria-label': `${layer.name || '레이어'} 표시`,
                checked: layer.visible !== false,
                onChange: e => void exec('update-custom-layer', {
                  entityId: selected.id,
                  layerId: layer.id,
                  patch: { visible: e.target.checked },
                }),
              }),
              h(CommitTextInput, {
                value: layer.name || '',
                placeholder: '레이어 이름',
                ariaLabel: '레이어 이름 수정',
                onCommit: nextName => void exec('update-custom-layer', {
                  entityId: selected.id,
                  layerId: layer.id,
                  patch: { name: nextName },
                }),
              }),
              h('input', {
                type: 'color',
                'aria-label': '레이어 색상 수정',
                value: safeHexColor(kind === 'polygon' ? layer.style?.fill : layer.style?.stroke, kind === 'polygon' ? '#bdbdbd' : '#171717'),
                onChange: e => void exec('update-custom-layer', {
                  entityId: selected.id,
                  layerId: layer.id,
                  patch: { style: kind === 'polygon' ? { fill: e.target.value } : { stroke: e.target.value } },
                }),
                style: { width: '24px', height: '24px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' },
              }),
              kind === 'polygon'
                ? h('select', {
                  'aria-label': '면 채움 무늬 수정',
                  value: layer.style?.pattern || 'none',
                  onChange: e => void exec('update-custom-layer', {
                    entityId: selected.id,
                    layerId: layer.id,
                    patch: { style: { pattern: e.target.value } },
                  }),
                  style: { ...compactInputStyle, width: 'auto' },
                },
                h('option', { value: 'none' }, '단색'),
                h('option', { value: 'hatch' }, '빗금'),
                h('option', { value: 'crosshatch' }, '교차'),
                h('option', { value: 'stipple' }, '점묘'))
                : kind === 'line'
                  ? h('select', {
                    'aria-label': '선 모양 수정',
                    value: lineMode,
                    onChange: e => {
                      const m = e.target.value;
                      void exec('update-custom-layer', {
                        entityId: selected.id,
                        layerId: layer.id,
                        patch: {
                          style: {
                            doubleLine: m === 'double',
                            dash: m === 'dashed' ? '4 3' : 'none',
                            strokeWidth: m === 'double' ? 3.2 : 1.5,
                          },
                        },
                      });
                    },
                    style: { ...compactInputStyle, width: 'auto' },
                  },
                  h('option', { value: 'solid' }, '단선'),
                  h('option', { value: 'double' }, '이중선'),
                  h('option', { value: 'dashed' }, '파선'))
                  : h('select', {
                    'aria-label': '마커 모양 수정',
                    value: layer.style?.marker || 'bullseye',
                    onChange: e => void exec('update-custom-layer', {
                      entityId: selected.id,
                      layerId: layer.id,
                      patch: { style: { marker: e.target.value } },
                    }),
                    style: { ...compactInputStyle, width: 'auto' },
                  },
                  h('option', { value: 'bullseye' }, '수도 ◎'),
                  h('option', { value: 'ring' }, '도넛 ○'),
                  h('option', { value: 'dot' }, '점 ●'),
                  h('option', { value: 'square' }, '사각 □'),
                  h('option', { value: 'triangle' }, '삼각 △')),
              h('button', {
                type: 'button',
                onClick: () => void exec('remove-custom-layer', { entityId: selected.id, layerId: layer.id }),
                style: btnStyle(false),
              }, '삭제'));
            }),
          ),
        ),
      ),

      h('details', { open: resolved.highlights.length > 0 || resolved.annotations.length > 0, style: boxStyle },
        h('summary', { style: { fontWeight: 600, fontSize: '11.5px', cursor: 'pointer' } },
          `강조 그룹 (${resolved.highlights.length}) · 지시선 라벨 (${resolved.annotations.length})`),
        h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } },
            h('select', { value: hlLevel, onChange: e => { setHlLevel(e.target.value); setHlCodes(''); setDistrictQuery(''); }, style: inputStyle },
              h('option', { value: 'admin0' }, '국가 (ISO 숫자)'),
              h('option', { value: 'admin1' }, '성·도 (CN-HL…)'),
              h('option', { value: 'kr-sido' }, '대한민국 시·도'),
              h('option', { value: 'kr-sgg' }, '대한민국 시·군·구'),
            ),
            h('input', { value: hlLabel, onChange: e => setHlLabel(e.target.value), placeholder: '범례 이름', style: inputStyle }),
          ),
          koreanNames && h(React.Fragment, null,
            h('input', { type: 'search', value: districtQuery, placeholder: '시·도, 시·군·구 이름 또는 코드 검색', 'aria-label': unit + ' 검색', style: inputStyle, onChange: e => setDistrictQuery(e.target.value) }),
            h('select', { value: '', style: inputStyle, 'aria-label': '강조할 ' + unit + ' 코드 추가', onChange: e => setHlCodes([...new Set([...hlCodes.split(/[,\s]+/).filter(Boolean), e.target.value])].join(', ')) },
              h('option', { value: '' }, unit + '를 선택해 코드 추가'),
              ...koreanNames.filter(row => row.join(' ').includes(districtQuery.trim())).map(([code, province, name]) => h('option', { key: code, value: code }, province + ' ' + name + ' (' + code + ')')))),
          h('input', { value: hlCodes, onChange: e => setHlCodes(e.target.value), placeholder: hlLevel === 'kr-sgg' ? '11110, 11680' : hlLevel === 'kr-sido' ? '11, 41' : '지역 코드 목록', style: inputStyle }),
          h('button', { type: 'button', onClick: handleAddHighlightGroup, style: btnStyle(false) }, '코드 강조 그룹 추가'),

          ...resolved.highlights.map((hl, idx) =>
            h('div', {
              key: `hl-${idx}`,
              'data-wm-highlight-row': String(idx),
              style: {
                display: 'grid',
                gap: '3px',
                padding: '5px 6px',
                borderRadius: '6px',
                background: 'var(--alid-bg-muted, #f4f4f5)',
                fontSize: '11px',
              },
            },
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '4px', alignItems: 'center' } },
              h(CommitTextInput, {
                value: hl.legendLabel || '',
                placeholder: `범례명 (${hl.level})`,
                ariaLabel: '강조 그룹 범례 이름 수정',
                onCommit: nextLabel => void exec('update-highlight', {
                  entityId: selected.id,
                  index: idx,
                  patch: { legendLabel: nextLabel },
                }),
              }),
              h('input', {
                type: 'color',
                'aria-label': '강조 그룹 색상 수정',
                value: safeHexColor(hl.fill, '#bdbdbd'),
                onChange: e => void exec('update-highlight', {
                  entityId: selected.id,
                  index: idx,
                  patch: { fill: e.target.value },
                }),
                style: { width: '24px', height: '24px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' },
              }),
              h('select', {
                'aria-label': '강조 그룹 무늬 수정',
                value: hl.pattern || 'none',
                onChange: e => void exec('update-highlight', {
                  entityId: selected.id,
                  index: idx,
                  patch: { pattern: e.target.value },
                }),
                style: { ...compactInputStyle, width: 'auto' },
              },
              h('option', { value: 'none' }, '단색'),
              h('option', { value: 'hatch' }, '빗금'),
              h('option', { value: 'crosshatch' }, '교차'),
              h('option', { value: 'stipple' }, '점묘')),
              h('button', {
                type: 'button',
                onClick: () => void exec('remove-highlight', { entityId: selected.id, index: idx }),
                style: btnStyle(false),
              }, '삭제')),
            h('small', { style: { color: 'var(--alid-text-muted, #71717a)', fontSize: '10px' } },
              `${hl.level}: ${hl.codes.join(', ')}`)),
          ),

          ...resolved.annotations.map(ann =>
            h('div', {
              key: ann.id,
              'data-wm-annotation-row': ann.id,
              style: {
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: '5px',
                alignItems: 'center',
                fontSize: '11px',
              },
            },
            h(CommitTextInput, {
              value: ann.text,
              placeholder: '지명',
              ariaLabel: '지시선 라벨 텍스트 수정',
              allowEmpty: false,
              onCommit: nextText => void exec('update-annotation', {
                entityId: selected.id,
                annotationId: ann.id,
                patch: { text: nextText },
              }),
            }),
            h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '10.5px', whiteSpace: 'nowrap' } },
              h('input', {
                type: 'checkbox',
                checked: Boolean(ann.leaderLine),
                onChange: e => void exec('update-annotation', {
                  entityId: selected.id,
                  annotationId: ann.id,
                  patch: { leaderLine: e.target.checked },
                }),
              }),
              '지시선'),
            h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '10.5px', whiteSpace: 'nowrap' } },
              h('input', {
                type: 'checkbox',
                checked: ann.halo !== false,
                onChange: e => void exec('update-annotation', {
                  entityId: selected.id,
                  annotationId: ann.id,
                  patch: { halo: e.target.checked },
                }),
              }),
              '테두리'),
            h('button', {
              type: 'button',
              onClick: () => void exec('remove-annotation', { entityId: selected.id, annotationId: ann.id }),
              style: btnStyle(false),
            }, '삭제')),
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
