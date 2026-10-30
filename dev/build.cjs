/**
 * 从 ../client.js 里抽出 CSS 数组，生成 _preview/notebook.css。
 * 目的：预览页用与插件完全相同的样式文本，避免两处维护走样。
 */
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
const start = source.indexOf('const CSS = [')
const end = source.indexOf("].join('\\n')", start)
if (start < 0 || end < 0) throw new Error('CSS array not found in client.js')

const body = source.slice(start + 'const CSS = '.length, end + 1)
const css = eval(body).join('\n') // eslint-disable-line no-eval

fs.writeFileSync(path.join(__dirname, 'notebook.css'), css, 'utf8')
console.log('extracted %d chars of CSS (%d rules)', css.length, (css.match(/\{/g) || []).length)
