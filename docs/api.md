# `diagram.white-map` 확장 계약 및 API 레퍼런스

## 1. 정본 어스펙트 (`diagram.white-map.map`)

| 필드 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `title` | `string` | `''` | 지도 상단 제목 (비워 두면 표시 안 함) |
| `regionPreset` | `string` | `'east-asia-oceania'` | 12종 내장 지역 프리셋 ID |
| `projection` | `string` | `'mercator'` | `mercator \| naturalEarth1 \| conicEqualArea \| equirectangular` |
| `viewport` | `{ centerLon, centerLat, scale, rotateLon }` | 지역 기본값 | 지도 중심 경위도, 배율(520px 폭 기준 정규화), 회전 경도 |
| `stylePreset` | `string` | `'admin0-highlight'` | 5종 수능 인쇄 프리셋 ID |
| `customCss` | `string` | `''` | `--map-*` 안전 선언 목록 |
| `baseLayers` | `object` | `{ coastline, borders, admin1, rivers, lakes, graticule }` | 기본 백지도 레이어 표시 여부 |
| `highlights` | `Array` | `[]` | Admin-0/Admin-1 코드 강조 그룹 |
| `customLayers` | `Array` | `[]` | GeoJSON/TopoJSON/CSV 커스텀 GIS 레이어 |
| `annotations` | `Array` | `[]` | 경위도 기준 지시선 라벨 |
| `inset` | `object` | `{ enabled, region, corner, offset }` | 위치 소지도 인셋 |
| `legend` | `object` | `{ enabled, corner, offset, items }` | 테두리 범례 박스 |
| `bakedDetail` | `object \| null` | `null` | 10m 공개 GIS CDN에서 클리핑·베이크한 오프라인 스냅샷 |

## 2. 인터랙션

- **더블클릭 지도 탐색**: 지도 프레임 내부를 더블클릭하면 `data-canvas-ui="true"`와 `data-escape-owner="true"`가 활성화되어 드래그(팬)와 휠(커서 기준 줌)이 지도 내부 탐색으로 전환됩니다. `Esc` 또는 바깥 클릭 시 최종 `viewport`가 한 번의 Undo 그룹으로 저장됩니다.
- **러버 밴드 & 이동 기즈모**: 백지도를 선택하면 범례 박스와 위치 소지도 인셋에 점선 러버 밴드와 이동 기즈모가 표시됩니다. 드래그로 위치를 조정할 수 있고 내보낸 SVG에 그대로 반영됩니다.

## 3. 명령 (`commands`)

- `diagram.white-map:insert-map`
- `diagram.white-map:explore-map`
- `diagram.white-map:set-region`
- `diagram.white-map:apply-preset`
- `diagram.white-map:update-style`
- `diagram.white-map:update-viewport`
- `diagram.white-map:toggle-layer`
- `diagram.white-map:toggle-highlight`
- `diagram.white-map:add-custom-layer`
- `diagram.white-map:remove-custom-layer`
- `diagram.white-map:add-annotation`
- `diagram.white-map:bake-high-res`
- `diagram.white-map:clear-baked`
- `diagram.white-map:reset-viewport`

## 4. 코파일럿 도구 (`workspace.tools`)

- `diagram.white-map:catalog` (읽기 전용)
- `diagram.white-map:search` (읽기 전용)
- `diagram.white-map:plan-changes` (`prepareChange` 사용자 승인 제안)
