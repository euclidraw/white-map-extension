# 수능 백지도 확장 (`euclidraw/white-map-extension`)

한국 수능·평가원 지리 양식의 **백지도(`diagram.white-map.map`)**를 Alid 캔버스 도형, 100% 순수 벡터 정적 SVG 출판, 백지도 스튜디오 패널, 코파일럿 승인 도구(`workspace.tools`)로 제공하는 공식 외부 저장소 확장입니다.

![수능 백지도 5종 프리셋 SVG 미리보기](docs/map-presets.svg)

## 주요 기능

- **특정 지역 중심 백지도 & 50m 오프라인 내장 GIS**:
  - 태평양 중심 세계, 동아시아·오세아니아, 중국 동북 3성, 한반도, 덴마크·독일(페마른벨트), 유럽 등 12종 지역 프리셋과 `Mercator`, `Natural Earth`, `Conic Equal-Area`, `Equirectangular` 투영법을 지원합니다.
  - 해안선(실선), 국경선(파선), 성·도 행정경계(점선), 주요 하천(254개), 호수, 적도(`0°`) 눈금을 오프라인으로 즉시 렌더링합니다.
- **크게 확대 시 10m 고해상도 공개 GIS CDN 스냅샷 베이크**:
  - 덴마크·독일 페마른벨트처럼 크게 확대했을 때 공개 정적 GIS CDN(Natural Earth 10m / world-atlas 10m)에서 현재 뷰포트 영역만 받아와 클리핑·단순화한 뒤 정본(`bakedDetail`)에 베이크합니다. 베이크 이후에는 오프라인과 SVG 내보내기에서도 동일한 10m 정밀도를 유지합니다.
- **더블클릭 지도 프레임 탐색**:
  - 백지도 프레임 안을 **더블클릭**하면 캔버스의 드래그·줌인아웃을 가로채 지도 프레임 내부에서 직접 팬(드래그)과 커서 기준 휠 줌을 수행합니다. `Shift+클릭`으로 국가·행정구역 강조를 토글할 수 있으며, `Esc`나 바깥 클릭 시 단일 Undo로 커밋됩니다.
- **수능 인쇄 스타일 5종 & 안전 `--map-*` 커스텀 CSS**:
  - 영문·숫자는 번들된 **CMU Serif**, 한글은 **Pretendard**를 사용합니다.
  - 단색 명암, 사선 빗금, 교차 빗금, 점묘(`stipple`), 이중선 경로(해저터널/철도), 수도 이중원(`◎`), 도넛 지점 마커, 위치 소지도 인셋, 지시선 라벨을 지원합니다.
  - 선택 시 범례 박스·위치 소지도에 **점선 러버 밴드와 이동 기즈모**가 표시되어 자유롭게 위치를 옮길 수 있습니다.
- **커스텀 GIS 매핑**:
  - GeoJSON, TopoJSON, CSV(`name,lon,lat`) 붙여넣기로 사용자 영역·경로·지점을 추가하거나 5종 수능 주제도 프리셋을 원클릭 적용할 수 있습니다.

## 설치 및 개발

Alid 워크벤치의 **확장 관리 → GitHub 저장소 설치**에 다음 저장소를 입력하세요.

```text
euclidraw/white-map-extension
```

로컬 개발 및 검증:

```bash
pnpm install
pnpm dev
pnpm test
pnpm check:dist
pnpm test:explore
pnpm test:host
```
