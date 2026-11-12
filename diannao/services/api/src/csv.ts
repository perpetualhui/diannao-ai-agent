/**
 * 店脑 · 最小 CSV 工具（零依赖）
 * 主责：B 邱
 *
 * 支持：双引号包裹字段、"" 转义为 "、字段内换行。
 * 不支持：多字节分隔符、注释行。够导入导出用。
 */

/** 解析 CSV 文本为二维数组（行 × 列）。首行视为表头。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // 统一换行
  const src = text.replace(/\r\n?/g, '\n');

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // 末行（无换行结尾）
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 去掉尾空行
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '')) {
    rows.pop();
  }
  return rows;
}

/** 序列化二维数组为 CSV 文本。字段含逗号/引号/换行时自动加引号转义。 */
export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (/[",\n]/.test(cell)) {
            return '"' + cell.replace(/"/g, '""') + '"';
          }
          return cell;
        })
        .join(','),
    )
    .join('\n');
}

/** 简易内容指纹（非加密，仅用于导入幂等去重）。 */
export function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(16);
}
