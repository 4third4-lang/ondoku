const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const marker = '/*\n * アプリの中心となる処理（サーバー側ロジック）';
const endMarker = '})(typeof globalThis !== "undefined" ? globalThis : this);';
function locate(text) {
  const start = text.indexOf(marker);
  if (start < 0 || text.indexOf(marker, start + marker.length) >= 0) throw new Error('Coreの開始位置を一意に特定できません');
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error('Coreの終了位置がありません');
  return { start, end: end + endMarker.length };
}
const gas = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8').replace(/\r\n/g, '\n');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/\r\n/g, '\n');
const a = locate(gas), b = locate(html), core = gas.slice(a.start, a.end);
if (process.argv.includes('--check')) {
  if (html.slice(b.start, b.end) !== core) throw new Error('Code.gsとindex.htmlのCoreが一致していません');
  console.log('Coreの一致を確認しました');
} else {
  fs.writeFileSync(htmlPath, html.slice(0, b.start) + core + html.slice(b.end));
  console.log('Code.gsのCoreをindex.htmlへ同期しました');
}
