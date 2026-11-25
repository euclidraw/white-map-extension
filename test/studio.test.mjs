import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMapPropsFromThematicPreset } from '../src/model.js';
import { WhiteMapStudioView } from '../src/panel.js';

test('studio panel renders 5 CSAT templates when idle and full GIS/print controls when selected', () => {
  const empty = renderToStaticMarkup(React.createElement(WhiteMapStudioView, {
    context: { getSelectedIds: () => [], world: { getCanonical: () => null } },
  }));
  assert.ok(empty.includes('수능 백지도 스튜디오'));
  assert.ok(empty.includes('페마른벨트 해저 터널 상세도'));
  assert.ok(!empty.includes('10m 고해상도 CDN 베이크'));

  const props = createMapPropsFromThematicPreset('csat-dongbei');
  const selectedHtml = renderToStaticMarkup(React.createElement(WhiteMapStudioView, {
    context: { getSelectedIds: () => ['m1'], world: { getCanonical: () => props } },
  }));
  assert.ok(selectedHtml.includes('프레임 탐색 (더블클릭)'));
  assert.ok(selectedHtml.includes('10m 고해상도 CDN 베이크'));
  assert.ok(selectedHtml.includes('수능 인쇄 스타일 · 사용자 CSS'));
});
