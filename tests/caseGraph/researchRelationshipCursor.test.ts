import { describe, expect, it } from 'vitest';

import {
  CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION,
  CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION,
  createCaseGraphResearchRelationshipCursorCodec,
  type CaseGraphResearchRelationshipCursorPayload,
} from '../../src/caseGraph/researchRelationshipCursor';

const payload = (): CaseGraphResearchRelationshipCursorPayload => ({
  version: CASE_GRAPH_RESEARCH_RELATIONSHIP_CURSOR_VERSION,
  sortVersion: CASE_GRAPH_RESEARCH_RELATIONSHIP_SORT_VERSION,
  tool: 'expand_relationships',
  publicationId: 'publication-v2',
  corpusVersion: 'corpus-v2',
  manifestSha256: 'a'.repeat(64),
  address: 'sighting:00000000-0000-4000-8000-000000000001',
  edgeTypes: ['shared_visual', 'space_time_candidate'],
  minimumStrength: 72.5,
  nextOffset: 50,
});

describe('signed Case Graph relationship cursor', () => {
  it('round-trips one canonical publication/query/sort-bound payload', () => {
    const codec = createCaseGraphResearchRelationshipCursorCodec('s'.repeat(32));
    const cursor = codec.encode(payload());
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(codec.decode(cursor)).toEqual(payload());
    expect(cursor).not.toContain('publication-v2');
  });

  it('rejects tampering and a cursor signed by another deployment secret', () => {
    const codec = createCaseGraphResearchRelationshipCursorCodec('s'.repeat(32));
    const cursor = codec.encode(payload());
    const [body, signature] = cursor.split('.');
    const replacement = body.endsWith('A') ? 'B' : 'A';
    expect(() => codec.decode(`${body.slice(0, -1)}${replacement}.${signature}`))
      .toThrow('case_graph_research_relationship_cursor_invalid');
    expect(() => createCaseGraphResearchRelationshipCursorCodec('t'.repeat(32)).decode(cursor))
      .toThrow('case_graph_research_relationship_cursor_invalid');
  });

  it('rejects noncanonical filters, offsets, hashes, shapes and weak secrets', () => {
    expect(() => createCaseGraphResearchRelationshipCursorCodec('short'))
      .toThrow('case_graph_research_relationship_cursor_secret_invalid');
    const codec = createCaseGraphResearchRelationshipCursorCodec('s'.repeat(32));
    for (const invalid of [
      { ...payload(), edgeTypes: [...payload().edgeTypes].reverse() },
      { ...payload(), nextOffset: 0 },
      { ...payload(), manifestSha256: 'not-a-digest' },
      { ...payload(), address: 'unknown:record' },
      { ...payload(), minimumStrength: 101 },
    ] as CaseGraphResearchRelationshipCursorPayload[]) {
      expect(() => codec.encode(invalid)).toThrow('case_graph_research_relationship_cursor_invalid');
    }
  });
});
