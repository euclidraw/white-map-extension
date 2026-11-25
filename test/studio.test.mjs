import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMapPropsFromThematicPreset } from '../src/model.js';
import { WhiteMapStudioView } from '../src/panel.js';

test('focused Map tab panel renders CSAT templates & region library, keeping scalar properties in Props panel', () => {
  const empty = renderToStaticMarkup(React.createElement(WhiteMapStudioView, {
    context: { getSelectedIds: () => [], world: { getCanonical: () => null } },
  }));
  assert.ok(empty.includes('수능 백지도'));
  assert.ok(empty.includes('페마른벨트 해저 터널 상세도'));
  assert.ok(empty.includes('지역 프리셋 라이브러리'));
  assert.ok(!empty.includes('커스텀 GIS 임포트'));

  const props = createMapPropsFromThematicPreset('csat-dongbei');
  const selectedHtml = renderToStaticMarkup(React.createElement(WhiteMapStudioView, {
    context: { getSelectedIds: () => ['m1'], world: { getCanonical: () => props } },
  }));
  assert.ok(selectedHtml.includes('커스텀 GIS 임포트 · 레이어 관리'));
  assert.ok(selectedHtml.includes('강조 그룹 (1) · 지시선 라벨 (2)'));
  assert.ok(selectedHtml.includes('고급 사용자 CSS (--map-*)'));
});
