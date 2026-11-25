# `diagram.white-map` 확장 계약 및 API 레퍼런스

**기준 좌표계:** WGS 84 (EPSG:4326), GeoJSON 배열은 `[경도, 위도]`(도) 순서다. `projection`은 출력 전용이다. `parseCustomGisInput(raw, sourceCrs)`에서 `auto`(기본), `EPSG:4326`, `EPSG:5179`를 지원한다. EPSG:5179의 입력 순서는 `[easting, northing]`(미터)이며, 반환된 `geojson`은 항상 경위도다. [레이어별 좌표 기준](../README.md#기준-좌표계-wgs-84-epsg4326)

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
| `highlights` | `Array` | `[]` | Admin-0/Admin-1 및 `kr-sgg`(대한민국 시·군·구 5자리 코드) 강조 그룹 |
| `customLayers` | `Array` | `[]` | GeoJSON/TopoJSON/CSV 커스텀 GIS 레이어 |
| `annotations` | `Array` | `[]` | 경위도 기준 지시선 라벨 |
| `inset` | `object` | `{ enabled, region, corner, offset }` | 위치 소지도 인셋 |
| `legend` | `object` | `{ enabled, corner, offset, items }` | 테두리 범례 박스 |
| `bakedDetail` | `boolean` | `false` | 고해상도 베이크 사용 여부. 좌표는 세션 전용이며 문서 복원 시 필요하면 다시 요청한다. 구형 스냅샷 객체는 `true`로 전환한다. |

`showKrProvinces` / `baseLayers.krProvinces`는 시·도 실선, `highlights[].level: 'kr-sido'`는 두 자리 시·도 코드(예: 서울 `11`)를 사용한다. 두 레이어가 켜져 있으면 시·군·구가 클릭 우선이며, 범례·강조 그룹에서는 두 단위를 독립 지정한다.

`showKrDistricts`(기본 `false`) 또는 `toggle-layer` 명령의 `layer: 'krDistricts'`로 한국 시군구 경계를 표시한다. `highlights: [{ level: 'kr-sgg', codes: ['11110'], fill: '#999999', legendLabel: '서울 종로구' }]`처럼 경계선 표시와 독립적으로 강조할 수 있다.

## 2. Props 패널 · 지도 탭 · 가로 Hover Tooltip 툴바

- **속성(Props) 패널 (`placement: 'inspector'`)**: 제목, 투영법, 중심 경위도·배율·경도 회전, 상세 타일/초기화, 기본 레이어 토글(해안선·국경·성/도·하천·호수·적도/격자), 범례·위치 소지도 토글 및 모서리 위치, 수능 인쇄 프리셋·바다/육지/강조/먹선 색상·해안선 굵기·국경 선종·서체·커스텀 CSS를 네이티브 필드로 제공합니다.
- **수능 백지도 탭 패널 (`diagram.white-map.studio`)**: 수능 백지도 5종 예제 템플릿, 12종 지역 프리셋 검색, GeoJSON/TopoJSON/CSV 커스텀 GIS 임포트 및 레이어·강조·라벨 목록 관리, 멀티라인 `--map-*` CSS 편집기에 집중합니다.
- **화면 상단 고정 Hover Tooltip 툴바 (`src/map-menubar.js`)**: 백지도를 선택하거나 탐색 중일 때 `alid-stem-extensions`와 동일하게 화면 상단 중앙(`left: 50%; top: 12px`)에 고정되는 가로 도구 막대가 나타납니다. 각 아이콘 버튼 아래로 호버 툴팁이 표시되며, 활성 도구·탐색 상태는 바로 아래 상태 행(`.stem-step`)에 표시됩니다. **선택·이동**, **지도 탐색**, **지시선 라벨 추가(지도 클릭 후 인라인 입력)**, **지점 마커 배치**, **경로 선 그리기(단선/이중선)**, **지역 강조 클릭**, **국경·하천·범례·인셋 토글**, **상세 타일**를 즉시 실행할 수 있습니다.

## 3. 인터랙션

- **더블클릭 지도 탐색**: 지도 프레임 내부를 더블클릭하면 `data-canvas-ui="true"`와 `data-escape-owner="true"`가 활성화되어 드래그(팬)와 휠(커서 기준 줌)이 지도 내부 탐색으로 전환됩니다. `Esc` 또는 바깥 클릭 시 최종 `viewport`가 한 번의 Undo 그룹으로 저장됩니다.
- **러버 밴드 & 이동 기즈모**: 백지도를 선택하면 범례 박스와 위치 소지도 인셋에 점선 러버 밴드와 이동 기즈모가 표시됩니다. 드래그로 위치를 조정할 수 있고 내보낸 SVG에 그대로 반영됩니다.

## 4. 명령 (`commands`)

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

## 5. 코파일럿 도구 (`workspace.tools`)

- `diagram.white-map:catalog` (읽기 전용)
- `diagram.white-map:search` (읽기 전용)
- `diagram.white-map:plan-changes` (`prepareChange` 사용자 승인 제안)
