import { createHash } from 'node:crypto';

import {
  DVIDS_FRAME_OCR_REVIEW_DRAFT_VERSION,
  verifyDvidsFrameOcrReviewAssignment,
} from './dvidsFrameOcrHumanReview';

export const DVIDS_FRAME_OCR_REVIEW_WORKBOOK_VERSION =
  'case-vortex-dvids-frame-ocr-human-review-workbook-v1' as const;

const inlineJson = (value: unknown) => JSON.stringify(value)
  .replace(/</gu, '\\u003c')
  .replace(/\u2028/gu, '\\u2028')
  .replace(/\u2029/gu, '\\u2029');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export const buildDvidsFrameOcrReviewWorkbook = (params: {
  assignment: unknown;
  frameBodies: ReadonlyMap<string, Buffer>;
}) => {
  const assignment = verifyDvidsFrameOcrReviewAssignment(params.assignment);
  if (assignment.items.length !== 1) {
    throw new Error('dvids_frame_ocr_review_workbook_item_count_invalid');
  }
  const frames = Object.fromEntries(assignment.items.map((item) => {
    const body = params.frameBodies.get(item.frameFileName);
    if (!body || body.byteLength !== item.frameBytes
      || sha256(body) !== item.frameSha256) {
      throw new Error('dvids_frame_ocr_review_workbook_frame_invalid');
    }
    return [item.frameFileName, `data:image/png;base64,${body.toString('base64')}`];
  }));
  if (params.frameBodies.size !== assignment.items.length) {
    throw new Error('dvids_frame_ocr_review_workbook_frame_accounting_invalid');
  }
  const bootstrap = inlineJson({
    workbookVersion: DVIDS_FRAME_OCR_REVIEW_WORKBOOK_VERSION,
    draftVersion: DVIDS_FRAME_OCR_REVIEW_DRAFT_VERSION,
    assignment,
    frames,
  });
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Case Vortex — frame OCR review</title>
<style>
:root{color-scheme:dark;--bg:#071018;--panel:#0d1a24;--line:#29404f;--text:#eef6fb;--muted:#9db0bd;--accent:#74d8c5;--warn:#ffc857;--danger:#ff8b8b}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#122735,#071018 42rem);color:var(--text);font:16px/1.5 system-ui,sans-serif}main{width:min(1100px,calc(100% - 2rem));margin:auto;padding:2rem 0 4rem}
h1,h2,p{margin:0}header{display:grid;gap:.65rem;margin-bottom:1rem}.eyebrow{color:var(--accent);font-weight:800;text-transform:uppercase;letter-spacing:.12em;font-size:.78rem}.notice{background:#211d11;border-left:3px solid var(--warn);padding:.75rem;color:#ffe7aa}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:1rem;padding:1rem}.meta{display:flex;gap:.5rem 1rem;flex-wrap:wrap;color:var(--muted);overflow-wrap:anywhere}.frame{display:block;max-width:100%;max-height:68vh;margin:1rem auto;border:1px solid var(--line);background:#000}
.machine{padding:.8rem;border:1px solid var(--line);background:#061019;border-radius:.6rem;font:1rem/1.5 ui-monospace,monospace}.fields,.reviewer{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:.8rem}.wide{grid-column:1/-1}label{display:grid;gap:.3rem;color:var(--muted)}
button,select,input,textarea{font:inherit;color:var(--text);background:#08141d;border:1px solid var(--line);border-radius:.5rem;padding:.6rem}textarea{min-height:6rem;resize:vertical}button{cursor:pointer}.primary{background:#145245;border-color:#2a8c78;font-weight:700}
.attest,.actions{display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-start;margin-top:1rem}.attest label{display:flex;flex-direction:row;color:var(--text);flex:1 1 20rem}.attest input{width:auto}.status{color:var(--muted)}.error{color:var(--danger)}
@media(max-width:700px){main{width:calc(100% - 1rem);padding-top:1rem}.fields,.reviewer{grid-template-columns:1fr}.wide{grid-column:auto}}
</style></head><body><main>
<header><div class="eyebrow">Case Vortex · exact recovered frame</div><h1>Frame OCR human review</h1>
<p>Compare the machine text to the exact checksum-bound frame at its stated timecode.</p>
<p class="notice">Frame text is not an event claim, object identity, transcript, or independent verification. This workbook cannot access the network or authorize publication.</p></header>
<section class="panel"><h2 id="heading">Review item</h2><div id="meta" class="meta"></div><img id="frame" class="frame" alt="Exact recovered video frame">
<p class="machine"><strong>Machine OCR:</strong> <span id="machine"></span></p>
<div class="fields"><label>Decision<select id="decision"><option value="">Choose…</option><option value="ocr_exact">OCR is exact</option><option value="ocr_corrected">OCR needs correction</option><option value="ocr_rejected">Reject OCR as incorrect/noise</option></select></label>
<label>Confidence<select id="confidence"><option value="">Choose…</option><option>low</option><option>medium</option><option>high</option></select></label>
<label class="wide">Corrected frame text<textarea id="corrected" placeholder="Required only when correcting OCR"></textarea></label>
<label class="wide">Rationale<textarea id="rationale" maxlength="2000" placeholder="At least 12 characters"></textarea></label></div>
<div class="reviewer"><label>Reviewer ID<input id="reviewer-id" autocomplete="off"></label><label>Completed at<input id="reviewed-at" type="datetime-local" step="1"></label></div>
<div class="attest"><label><input id="human" type="checkbox">I personally performed this review.</label><label><input id="frame-viewed" type="checkbox">I viewed the exact recovered frame shown.</label><label><input id="origin" type="checkbox">I preserved machine-OCR origin.</label><label><input id="limits" type="checkbox">I imply no event claim or identity.</label></div>
<div class="actions"><button id="export" class="primary" type="button">Export completed draft</button><span id="status" class="status" role="status"></span></div>
</section></main>
<script id="bootstrap" type="application/json">${bootstrap}</script>
<script>
(()=>{'use strict';const boot=JSON.parse(document.getElementById('bootstrap').textContent),assignment=boot.assignment,item=assignment.items[0],el=id=>document.getElementById(id);
el('meta').textContent=item.address+' · '+item.keyframeMs+' ms · frame SHA-256 '+item.frameSha256;el('frame').src=boot.frames[item.frameFileName];el('machine').textContent=item.machineText+' · confidence '+item.machineConfidence;
el('decision').onchange=()=>{el('corrected').disabled=el('decision').value!=='ocr_corrected';if(el('corrected').disabled)el('corrected').value=''};el('decision').onchange();
const reviewedAt=()=>{const value=el('reviewed-at').value;if(!value)return null;const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString():null};
el('export').onclick=()=>{const decision=el('decision').value||null,corrected=el('corrected').value.trim()||null,rationale=el('rationale').value.trim()||null,confidence=el('confidence').value||null;
const att={humanPerformed:el('human').checked||null,viewedExactRecoveredFrames:el('frame-viewed').checked||null,preservedMachineOcrOrigin:el('origin').checked||null,noEventClaimOrIdentityImplied:el('limits').checked||null};
const valid=decision&&confidence&&rationale&&rationale.length>=12&&((decision==='ocr_corrected'&&corrected&&corrected!==item.machineText)||(decision!=='ocr_corrected'&&!corrected))&&Object.values(att).every(value=>value===true)&&el('reviewer-id').value.trim().length>=3&&reviewedAt();
if(!valid){el('status').textContent='Complete the decision, correction rule, confidence, rationale, reviewer details and attestations.';el('status').className='status error';return}
const draft={recordType:'dvids_frame_ocr_human_review_draft',schemaVersion:boot.draftVersion,assignmentDigest:assignment.assignmentDigest,reviewerId:el('reviewer-id').value.trim().toLowerCase(),reviewedAt:reviewedAt(),attestation:att,reviews:[{itemId:item.itemId,decision,correctedText:corrected,confidence,rationale}]};
const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)+'\\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='dvids-frame-ocr-review-completed.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);el('status').textContent='Completed draft exported for fail-closed sealing.';el('status').className='status'};
})();
</script></body></html>`;
};
