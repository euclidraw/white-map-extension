import regular from 'computer-modern/fonts/cmu-serif-500-roman.woff2?inline';
import bold from 'computer-modern/fonts/cmu-serif-700-roman.woff2?inline';
import license from 'computer-modern/OFL.txt?raw';

export { KOREAN_SANS, MAP_FONT } from './font-names.js';

export const cmuFontCss = [
  [regular, '100 599'],
  [bold, '600 900'],
].map(([src, weight]) =>
  `@font-face{font-family:"CMU Serif";font-style:normal;font-weight:${weight};font-display:swap;src:url("${src}") format("woff2");}`,
).join('\n');

export const cmuSvgDefs = `<metadata>${license.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</metadata><style>${cmuFontCss}</style>`;
