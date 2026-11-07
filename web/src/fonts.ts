// Seven-segment LCD font for readings (DSEG7 Classic, SIL Open Font License 1.1).
// Bundled with the app rather than loaded from a CDN so the dashboard works offline.
import regular from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-Regular.woff2?url';
import bold from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2?url';

for (const [url, weight] of [
  [regular, '400'],
  [bold, '700'],
] as const) {
  try {
    const face = new FontFace('DSEG7', `url(${url}) format('woff2')`, { weight, display: 'swap' });
    document.fonts.add(face);
    void face.load().catch(() => {});
  } catch {
    /* FontFace unsupported: readings fall back to the UI font */
  }
}
