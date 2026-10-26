const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
new vm.Script(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let count = 0;
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  count++;
  new vm.Script(match[1], { filename: 'index.html:inline-script-' + count });
}
console.log('構文確認: Code.gs と index.html の ' + count + ' 個のスクリプトが正常です');
