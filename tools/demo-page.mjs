/**
 * Inlines the demo build (dist-demo) into one HTML page body for sharing as a private page.
 *   node tools/demo-page.mjs <out.html>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('usage: node tools/demo-page.mjs <out.html>');
const assets = readdirSync('dist-demo/assets');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`dist-demo/assets/${f}`, 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`dist-demo/assets/${f}`, 'utf8')).join('\n');
const page = `<title>Card Desk Drops</title>
<meta name="theme-color" content="#ffffff" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,400..900;1,62..125,700..900&display=swap" />
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync(out, page);
console.log(`${out}: ${(page.length / 1024).toFixed(0)} KB`);
