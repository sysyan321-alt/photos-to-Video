'use strict';

/**
 * 前端静态自检：校验 ESM import 路径、index.html 引用、以及组件是否都能被解析到。
 * 浏览器里模块 404 会直接白屏，所以这一步放在构建前跑。
 * 用法：node scripts/check-web.js
 */

const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.join(__dirname, '..', 'web');
const problems = [];

function walk(dir, bucket = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'vendor') continue;
            walk(full, bucket);
        } else if (entry.name.endsWith('.js')) {
            bucket.push(full);
        }
    }
    return bucket;
}

function resolveSpecifier(fromFile, specifier) {
    if (specifier.startsWith('/')) return path.join(WEB_ROOT, specifier);
    return path.resolve(path.dirname(fromFile), specifier);
}

const files = walk(path.join(WEB_ROOT, 'src'));
let importCount = 0;

for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /(?:^|\n)\s*import\s+[^'"]*from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = pattern.exec(source))) {
        importCount += 1;
        const target = resolveSpecifier(file, match[1]);
        if (!fs.existsSync(target)) {
            problems.push(`${path.relative(WEB_ROOT, file)} -> 找不到 ${match[1]}`);
        }
    }
}

// index.html 里的引用也要存在
const indexHtml = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
for (const match of indexHtml.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const target = path.join(WEB_ROOT, match[1]);
    if (!fs.existsSync(target)) problems.push(`index.html -> 找不到 ${match[1]}`);
}

// 组件命名规范：都应该是 defineComponent 导出的模块
for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (/^\/\//.test(path.basename(file))) continue;
    if (!/export default defineComponent/.test(source) && !/export (async )?function|export const/.test(source)) {
        problems.push(`${path.relative(WEB_ROOT, file)} 没有导出组件或函数`);
    }
}

console.log(`检查 ${files.length} 个前端模块，${importCount} 条 import 引用`);
if (problems.length) {
    console.error('发现问题：');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
}
console.log('前端模块图 OK');
