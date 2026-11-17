const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quoteSqlIdentifierPart = (part: string) => {
  if (!SQL_IDENTIFIER_RE.test(part)) {
    throw new Error(`Unsafe SQL identifier segment: ${part}`);
  }
  return `"${part.replace(/"/g, '""')}"`;
};

export const quoteSqlIdentifier = (identifier: string) => {
  const trimmed = String(identifier || '').trim();
  if (!trimmed) {
    throw new Error('Unsafe SQL identifier: empty identifier.');
  }
  return quoteSqlIdentifierPart(trimmed);
};

export const quoteSqlIdentifierPath = (identifierPath: string) => {
  const trimmed = String(identifierPath || '').trim();
  if (!trimmed) {
    throw new Error('Unsafe SQL identifier: empty identifier path.');
  }
  return trimmed.split('.').map(quoteSqlIdentifierPart).join('.');
};
