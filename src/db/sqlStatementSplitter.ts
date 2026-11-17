// PostgreSQL-aware statement splitter. Understands:
// - single-quoted strings with '' escape
// - dollar-quoted strings ($$...$$, $tag$...$tag$), used for DO blocks
// - line comments (-- ... \n)
// - block comments (/* ... */, nestable per PostgreSQL rules)
// - double-quoted identifiers
// Splits on ; at nesting depth 0. Empty/whitespace statements are dropped.

const tryDollarTag = (sql: string, from: number): { tag: string; len: number } | null => {
  if (sql[from] !== '$') return null;
  let j = from + 1;
  if (sql[j] === '$') return { tag: '$$', len: 2 };
  const first = sql[j];
  if (!first || !/[A-Za-z_]/.test(first)) return null;
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
  if (sql[j] !== '$') return null;
  return { tag: sql.slice(from, j + 1), len: j + 1 - from };
};

export const splitSqlStatements = (sql: string): string[] => {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  const startsWith = (s: string, from: number) => sql.startsWith(s, from);

  while (i < n) {
    const ch = sql[i];

    if (startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end + 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (startsWith('/*', i)) {
      let depth = 1;
      buf += '/*';
      i += 2;
      while (i < n && depth > 0) {
        if (startsWith('/*', i)) {
          depth += 1;
          buf += '/*';
          i += 2;
        } else if (startsWith('*/', i)) {
          depth -= 1;
          buf += '*/';
          i += 2;
        } else {
          buf += sql[i];
          i += 1;
        }
      }
      continue;
    }

    const dq = ch === '$' ? tryDollarTag(sql, i) : null;
    if (dq) {
      buf += dq.tag;
      i += dq.len;
      while (i < n) {
        if (startsWith(dq.tag, i)) {
          buf += dq.tag;
          i += dq.tag.length;
          break;
        }
        buf += sql[i];
        i += 1;
      }
      continue;
    }

    if (ch === "'") {
      buf += "'";
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += "''";
          i += 2;
        } else if (sql[i] === "'") {
          buf += "'";
          i += 1;
          break;
        } else {
          buf += sql[i];
          i += 1;
        }
      }
      continue;
    }

    if (ch === '"') {
      buf += '"';
      i += 1;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          buf += '""';
          i += 2;
        } else if (sql[i] === '"') {
          buf += '"';
          i += 1;
          break;
        } else {
          buf += sql[i];
          i += 1;
        }
      }
      continue;
    }

    if (ch === ';') {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = '';
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
};
