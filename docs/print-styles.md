# 수능 백지도 인쇄 스타일 & 커스텀 CSS

![수능 백지도 5종 프리셋 SVG 미리보기](map-presets.svg)

## 5종 인쇄 프리셋

| 프리셋 ID | 특징 |
| --- | --- |
| `world-distribution` | 태평양 중심 세계 백지도, 흰 바다·실선 해안선·좌측 `0°` 적도 눈금, 회색·진회색·점묘(`stipple`) 분포 + 좌하단 범례 |
| `regional-physical` | 옅은 회색 바다(`#eaeaea`)·흰 육지·국경 없음·우측 `0°` 적도 눈금 + 굵은 도넛 지점 마커 |
| `detail-corridor` | 회색 바다·파선 국경·좌하단 유럽 위치 소지도 인셋 + 단선/이중선 경로·지시선 라벨 |
| `admin1-highlight` | 3단 경계 위계(해안선 실선 / 국경 파선 / 성·도 경계 점선) + 행정구역 채움·이중원 수도 기호 |
| `admin0-highlight` | 흰 바다·파선 국경 + 선택 국가 중회색(`#9a9a9a`) 채움·좌측 `0°` 적도 눈금 |

## 커스텀 `--map-*` CSS 선언

선택자 없이 세미콜론으로 구분된 `--map-*` 선언만 허용합니다. 검증된 값만 벡터 SVG 속성으로 변환합니다.

```css
--map-ocean: #eaeaea;
--map-land: #ffffff;
--map-ink: #171717;
--map-coast: #171717;
--map-coast-width: 0.9px;
--map-border: #444444;
--map-border-width: 0.75px;
--map-border-dash: 5 3;
--map-admin1: #3a3a3a;
--map-admin1-width: 0.75px;
--map-admin1-dash: 1.3 2.2;
--map-river: #555555;
--map-river-width: 0.65px;
--map-frame-width: 1.1px;
--map-font: serif;
```
