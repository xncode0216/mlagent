export type CsvPreview = {
  headers: string[];
  rows: string[][];
};

/** 解析 CSV 文本用于预览，支持双引号包裹的字段与 `""` 转义。 */
export function parseCsvPreview(content: string, maxRows = 50): CsvPreview {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      if (rows.length > maxRows) break;
      continue;
    }
    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headers = [], ...body] = rows.filter((item) => item.some((cell) => cell.length > 0));
  return { headers, rows: body.slice(0, maxRows) };
}
