// 构建后写入 dist/package.json，标记 CommonJS：根 package.json 是 "type":"module"，
// 而 API 编译产物是 CommonJS，需要让 Node 就近读取到 commonjs 类型标记。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distPkg = resolve(here, '..', 'dist', 'package.json');
mkdirSync(dirname(distPkg), { recursive: true });
writeFileSync(distPkg, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n', 'utf8');
console.log('[build] wrote', distPkg);
