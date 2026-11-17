import {
  SATNOGS_DIRECTION_REVIEW_DRAFT_VERSION,
  verifySatnogsDirectionReviewAssignment,
} from './satnogsDirectionHumanReview';

export const SATNOGS_DIRECTION_REVIEW_WORKBOOK_VERSION =
  'case-vortex-satnogs-direction-review-workbook-v1' as const;

const jsonForInlineScript = (value: unknown) => JSON.stringify(value)
  .replace(/</gu, '\\u003c')
  .replace(/\u2028/gu, '\\u2028')
  .replace(/\u2029/gu, '\\u2029');

export const buildSatnogsDirectionReviewWorkbook = (
  assignmentValue: unknown,
) => {
  const assignment = verifySatnogsDirectionReviewAssignment(assignmentValue);
  const bootstrap = jsonForInlineScript({
    workbookVersion: SATNOGS_DIRECTION_REVIEW_WORKBOOK_VERSION,
    draftVersion: SATNOGS_DIRECTION_REVIEW_DRAFT_VERSION,
    assignment,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Case Vortex — Independent Direction Review</title>
  <style>
    :root { color-scheme: dark; --bg:#071018; --panel:#0d1a24; --line:#243746; --text:#eef6fb; --muted:#9db0bd; --accent:#74d8c5; --warning:#ffc857; --danger:#ff8b8b; }
    * { box-sizing: border-box; }
    body { margin:0; background:radial-gradient(circle at top,#122735 0,#071018 42rem); color:var(--text); font:16px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button,select,input,textarea { font:inherit; }
    button,select,input,textarea,.file-button { color:var(--text); background:#09151e; border:1px solid var(--line); border-radius:.55rem; }
    button,.file-button { cursor:pointer; padding:.65rem .9rem; }
    button:hover,button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,.file-button:hover,.file-button:focus-within { border-color:var(--accent); outline:2px solid color-mix(in srgb,var(--accent) 45%,transparent); outline-offset:2px; }
    button.primary { background:#145245; border-color:#2a8c78; font-weight:700; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    main { width:min(1060px,calc(100% - 2rem)); margin:0 auto; padding:2rem 0 4rem; }
    header { display:grid; gap:.65rem; margin-bottom:1.25rem; }
    h1,h2,p { margin:0; }
    h1 { font-size:clamp(1.6rem,4vw,2.5rem); line-height:1.1; }
    .eyebrow { color:var(--accent); text-transform:uppercase; letter-spacing:.12em; font-size:.78rem; font-weight:800; }
    .muted { color:var(--muted); }
    .notice { border-left:3px solid var(--warning); padding:.7rem .9rem; background:#211d11; color:#ffe7aa; border-radius:.25rem; }
    .toolbar,.reviewer,.nav,.attestations { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; }
    .panel { background:color-mix(in srgb,var(--panel) 94%,transparent); border:1px solid var(--line); border-radius:1rem; padding:1rem; box-shadow:0 1.2rem 4rem #0006; }
    .toolbar { justify-content:space-between; margin-bottom:1rem; }
    .progress { min-width:15rem; flex:1; }
    progress { width:100%; height:.8rem; accent-color:var(--accent); }
    label { display:grid; gap:.35rem; color:var(--muted); font-size:.9rem; }
    select,input,textarea { width:100%; padding:.65rem .75rem; }
    textarea { min-height:7rem; resize:vertical; }
    .source-meta { display:flex; flex-wrap:wrap; gap:.45rem 1rem; color:var(--muted); font-size:.84rem; overflow-wrap:anywhere; }
    .source-text { margin:1rem 0; padding:1rem; white-space:pre-wrap; overflow-wrap:anywhere; background:#08131b; border:1px solid var(--line); border-radius:.75rem; font:1rem/1.65 ui-monospace,SFMono-Regular,Menlo,monospace; }
    mark { background:#8b5e00; color:#fff7dc; border-radius:.2rem; padding:.05rem .12rem; }
    .fields { display:grid; grid-template-columns:1fr 1fr; gap:.8rem; }
    .fields .wide { grid-column:1/-1; }
    .nav { justify-content:space-between; margin-top:1rem; }
    .reviewer { margin-top:1rem; padding-top:1rem; border-top:1px solid var(--line); }
    .reviewer label { flex:1 1 16rem; }
    .attestations { align-items:flex-start; margin-top:1rem; }
    .attestations label { display:flex; grid-template-columns:none; flex-direction:row; align-items:flex-start; flex:1 1 17rem; color:var(--text); }
    .attestations input { width:auto; margin-top:.25rem; }
    .export { display:flex; align-items:center; gap:.8rem; flex-wrap:wrap; margin-top:1rem; }
    .file-button { display:inline-flex; color:var(--text); font-size:1rem; }
    .file-button input { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
    #status { min-height:1.5rem; color:var(--muted); }
    #status.error { color:var(--danger); }
    #status.success { color:var(--accent); }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
    @media (max-width:700px) {
      main { width:min(100% - 1rem,1060px); padding-top:1rem; }
      .panel { padding:.8rem; border-radius:.75rem; }
      .fields { grid-template-columns:1fr; }
      .fields .wide { grid-column:auto; }
      .toolbar { align-items:stretch; }
      .progress { min-width:100%; }
      .nav button { flex:1; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">Case Vortex · blinded calibration</div>
    <h1>Independent direction review</h1>
    <p class="muted">Classify what each highlighted phrase means in its exact source text. Satellite identities, propagation and match outputs are not present.</p>
    <p class="notice">This workbook never assigns azimuth, elevation, identity or causation. Export is enabled only after every item and human attestation is complete.</p>
  </header>
  <section class="panel" aria-labelledby="review-heading">
    <div class="toolbar">
      <div class="progress">
        <div id="progress-text" aria-live="polite">0 reviewed</div>
        <progress id="progress" value="0" max="1"></progress>
      </div>
      <label>Show
        <select id="filter">
          <option value="all">All items</option>
          <option value="unreviewed">Unreviewed only</option>
          <option value="confirmed">Confirmed sky positions</option>
        </select>
      </label>
    </div>
    <article id="review-item">
      <h2 id="review-heading" tabindex="-1">Review item</h2>
      <div class="source-meta" id="source-meta"></div>
      <div class="source-text" id="source-text" aria-label="Exact source text"></div>
      <div class="fields">
        <label>Decision
          <select id="decision">
            <option value="">Choose a decision…</option>
          </select>
        </label>
        <label>Confidence in this classification
          <select id="confidence">
            <option value="">Choose confidence…</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label class="wide">Rationale (at least 12 characters)
          <textarea id="rationale" maxlength="2000" placeholder="Explain what the highlighted phrase means in this source text."></textarea>
        </label>
      </div>
      <div class="nav">
        <button id="previous" type="button">Previous</button>
        <span id="position" class="muted" aria-live="polite"></span>
        <button id="next" type="button">Next</button>
      </div>
    </article>
    <div class="reviewer">
      <label>Reviewer ID
        <input id="reviewer-id" autocomplete="off" placeholder="human-reviewer-id">
      </label>
      <label>Review completed at
        <input id="reviewed-at" type="datetime-local" step="1">
      </label>
    </div>
    <div class="attestations" aria-label="Required human attestations">
      <label><input id="human-performed" type="checkbox"> I personally performed this human review.</label>
      <label><input id="exact-text" type="checkbox"> I reviewed the exact source text shown for every item.</label>
      <label><input id="independent" type="checkbox"> I reviewed independently of satellite or match outputs.</label>
    </div>
    <div class="export">
      <label class="file-button">Import checkpoint JSON
        <input id="import-checkpoint" type="file" accept="application/json,.json">
      </label>
      <button id="export-checkpoint" type="button">Export checkpoint</button>
      <button id="export" class="primary" type="button">Export completed JSON draft</button>
      <span id="status" role="status" aria-live="polite"></span>
    </div>
  </section>
</main>
<script id="bootstrap" type="application/json">${bootstrap}</script>
<script>
(() => {
  'use strict';
  const boot = JSON.parse(document.getElementById('bootstrap').textContent);
  const assignment = boot.assignment;
  const reviews = new Map(assignment.items.map(item => [item.itemId, {
    itemId: item.itemId, decision: null, confidence: null, rationale: null,
  }]));
  let visible = assignment.items.map(item => item.itemId);
  let index = 0;
  let dirty = false;
  const byId = new Map(assignment.items.map(item => [item.itemId, item]));
  const el = id => document.getElementById(id);
  const decisionLabels = {
    object_sky_position_confirmed: 'Object sky position confirmed',
    object_motion_only: 'Object motion only',
    observer_or_camera_direction: 'Observer or camera direction',
    geographic_or_place_reference: 'Geographic or place reference',
    ambiguous_or_insufficient: 'Ambiguous or insufficient',
    unrelated_text: 'Unrelated text',
  };
  const decisionSet = new Set(assignment.protocol.decisions);
  const confidenceSet = new Set(['low', 'medium', 'high']);
  const reviewerIdPattern = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/;
  const exactKeys = (value, expected) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length
      && actual.every((key, position) => key === wanted[position]);
  };
  for (const decision of assignment.protocol.decisions) {
    const option = document.createElement('option');
    option.value = decision;
    option.textContent = decisionLabels[decision] || decision;
    el('decision').append(option);
  }
  const byteParts = (text, start, end) => {
    const bytes = new TextEncoder().encode(text);
    const decode = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
    return [decode(bytes.slice(0, start)), decode(bytes.slice(start, end)), decode(bytes.slice(end))];
  };
  const currentId = () => visible[index] || null;
  const persistCurrent = () => {
    const id = currentId();
    if (!id) return;
    const review = reviews.get(id);
    review.decision = el('decision').value || null;
    review.confidence = el('confidence').value || null;
    review.rationale = el('rationale').value.trim() || null;
    dirty = true;
  };
  const complete = review => Boolean(
    review.decision && review.confidence && review.rationale && review.rationale.length >= 12
  );
  const updateProgress = () => {
    const count = [...reviews.values()].filter(complete).length;
    el('progress').max = assignment.items.length;
    el('progress').value = count;
    el('progress-text').textContent = count + ' of ' + assignment.items.length + ' reviewed';
  };
  const reviewedAtIso = () => {
    const value = el('reviewed-at').value;
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  };
  const isoToLocalInput = value => {
    const parsed = new Date(value);
    return new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000))
      .toISOString()
      .slice(0, 19);
  };
  const currentDraft = () => ({
    recordType: 'satnogs_direction_review_draft',
    schemaVersion: boot.draftVersion,
    assignmentDigest: assignment.assignmentDigest,
    reviewerId: el('reviewer-id').value.trim().toLowerCase() || null,
    reviewedAt: reviewedAtIso(),
    attestation: {
      humanPerformed: el('human-performed').checked || null,
      reviewedExactSourceText: el('exact-text').checked || null,
      independentOfSatelliteOutputs: el('independent').checked || null,
    },
    reviews: assignment.items.map(item => reviews.get(item.itemId)),
  });
  const downloadDraft = (draft, filename) => {
    const body = JSON.stringify(draft, null, 2) + '\\n';
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const validateCheckpoint = value => {
    if (!exactKeys(value, [
      'recordType', 'schemaVersion', 'assignmentDigest', 'reviewerId',
      'reviewedAt', 'attestation', 'reviews',
    ])
      || value.recordType !== 'satnogs_direction_review_draft'
      || value.schemaVersion !== boot.draftVersion
      || value.assignmentDigest !== assignment.assignmentDigest
      || (value.reviewerId !== null && (
        typeof value.reviewerId !== 'string' || !reviewerIdPattern.test(value.reviewerId)
      ))
      || (value.reviewedAt !== null && (
        typeof value.reviewedAt !== 'string'
        || !Number.isFinite(new Date(value.reviewedAt).getTime())
        || new Date(value.reviewedAt).toISOString() !== value.reviewedAt
      ))
      || !exactKeys(value.attestation, [
        'humanPerformed', 'reviewedExactSourceText', 'independentOfSatelliteOutputs',
      ])
      || !Object.values(value.attestation).every(entry => entry === null || entry === true)
      || !Array.isArray(value.reviews)
      || value.reviews.length !== assignment.items.length) {
      throw new Error('Checkpoint shape or assignment binding is invalid.');
    }
    const imported = new Map();
    for (const review of value.reviews) {
      if (!exactKeys(review, ['itemId', 'decision', 'confidence', 'rationale'])
        || typeof review.itemId !== 'string'
        || !byId.has(review.itemId)
        || imported.has(review.itemId)
        || (review.decision !== null && !decisionSet.has(review.decision))
        || (review.confidence !== null && !confidenceSet.has(review.confidence))
        || (review.rationale !== null && (
          typeof review.rationale !== 'string'
          || review.rationale !== review.rationale.trim()
          || !review.rationale.length
          || review.rationale.length > 2000
        ))) {
        throw new Error('Checkpoint review content is invalid.');
      }
      imported.set(review.itemId, {
        itemId: review.itemId,
        decision: review.decision,
        confidence: review.confidence,
        rationale: review.rationale,
      });
    }
    if (imported.size !== assignment.items.length) {
      throw new Error('Checkpoint item set is incomplete.');
    }
    return { value, imported };
  };
  const render = () => {
    const id = currentId();
    const article = el('review-item');
    if (!id) {
      article.hidden = true;
      el('position').textContent = 'No items in this filter';
      return;
    }
    article.hidden = false;
    const item = byId.get(id);
    const review = reviews.get(id);
    el('review-heading').textContent = 'Review item ' + (index + 1);
    el('source-meta').textContent = item.source + ' · ' + item.subjectAddress + ' · ' + item.sourceField + (item.canonicalUrl ? ' · ' + item.canonicalUrl : '');
    const source = el('source-text');
    source.replaceChildren();
    const parts = byteParts(item.sourceText, item.span.start, item.span.end);
    source.append(document.createTextNode(parts[0]));
    const mark = document.createElement('mark');
    mark.textContent = parts[1];
    source.append(mark, document.createTextNode(parts[2]));
    el('decision').value = review.decision || '';
    el('confidence').value = review.confidence || '';
    el('rationale').value = review.rationale || '';
    el('position').textContent = (index + 1) + ' of ' + visible.length;
    el('previous').disabled = index === 0;
    el('next').disabled = index >= visible.length - 1;
    updateProgress();
  };
  const applyFilter = () => {
    persistCurrent();
    const filter = el('filter').value;
    visible = assignment.items.filter(item => {
      const review = reviews.get(item.itemId);
      if (filter === 'unreviewed') return !complete(review);
      if (filter === 'confirmed') return review.decision === 'object_sky_position_confirmed';
      return true;
    }).map(item => item.itemId);
    index = Math.min(index, Math.max(0, visible.length - 1));
    render();
  };
  const move = delta => {
    persistCurrent();
    index = Math.max(0, Math.min(visible.length - 1, index + delta));
    render();
    el('review-heading').focus({ preventScroll: true });
  };
  el('decision').addEventListener('change', () => { persistCurrent(); updateProgress(); });
  el('confidence').addEventListener('change', () => { persistCurrent(); updateProgress(); });
  el('rationale').addEventListener('input', () => { persistCurrent(); updateProgress(); });
  el('previous').addEventListener('click', () => move(-1));
  el('next').addEventListener('click', () => move(1));
  el('filter').addEventListener('change', applyFilter);
  el('export-checkpoint').addEventListener('click', () => {
    persistCurrent();
    downloadDraft(currentDraft(), 'satnogs-direction-review-checkpoint.json');
    el('status').className = 'success';
    el('status').textContent = 'Checkpoint exported. Keep it private and import it here to resume.';
    dirty = false;
  });
  el('import-checkpoint').addEventListener('change', async event => {
    const status = el('status');
    status.className = 'error';
    const file = event.target.files && event.target.files[0];
    try {
      if (!file || file.size < 2 || file.size > 4 * 1024 * 1024) {
        throw new Error('Choose a JSON checkpoint smaller than 4 MiB.');
      }
      const parsed = JSON.parse(await file.text());
      const checkpoint = validateCheckpoint(parsed);
      for (const [itemId, review] of checkpoint.imported) reviews.set(itemId, review);
      el('reviewer-id').value = checkpoint.value.reviewerId || '';
      el('reviewed-at').value = checkpoint.value.reviewedAt
        ? isoToLocalInput(checkpoint.value.reviewedAt)
        : '';
      el('human-performed').checked = checkpoint.value.attestation.humanPerformed === true;
      el('exact-text').checked = checkpoint.value.attestation.reviewedExactSourceText === true;
      el('independent').checked = checkpoint.value.attestation.independentOfSatelliteOutputs === true;
      el('filter').value = 'all';
      visible = assignment.items.map(item => item.itemId);
      const firstIncomplete = visible.findIndex(itemId => !complete(reviews.get(itemId)));
      index = firstIncomplete < 0 ? 0 : firstIncomplete;
      render();
      status.className = 'success';
      status.textContent = 'Checkpoint imported and assignment binding verified.';
      dirty = false;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Checkpoint import failed.';
    } finally {
      event.target.value = '';
    }
  });
  el('export').addEventListener('click', () => {
    persistCurrent();
    const incomplete = [...reviews.values()].filter(review => !complete(review));
    const reviewerId = el('reviewer-id').value.trim().toLowerCase();
    const reviewedLocal = el('reviewed-at').value;
    const attestation = {
      humanPerformed: el('human-performed').checked,
      reviewedExactSourceText: el('exact-text').checked,
      independentOfSatelliteOutputs: el('independent').checked,
    };
    const status = el('status');
    status.className = 'error';
    if (incomplete.length) {
      status.textContent = incomplete.length + ' review items are incomplete.';
      return;
    }
    if (!reviewerIdPattern.test(reviewerId)) {
      status.textContent = 'Enter a valid reviewer ID.';
      return;
    }
    if (!reviewedLocal || !reviewedAtIso()) {
      status.textContent = 'Enter the review completion time.';
      return;
    }
    if (!Object.values(attestation).every(Boolean)) {
      status.textContent = 'Complete all three human attestations.';
      return;
    }
    const draft = currentDraft();
    draft.reviewerId = reviewerId;
    draft.reviewedAt = reviewedAtIso();
    draft.attestation = attestation;
    downloadDraft(draft, 'satnogs-direction-review-completed-draft.json');
    status.className = 'success';
    status.textContent = 'Completed JSON draft exported. Run the strict seal command next.';
    dirty = false;
  });
  window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  render();
})();
</script>
</body>
</html>
`;
};
