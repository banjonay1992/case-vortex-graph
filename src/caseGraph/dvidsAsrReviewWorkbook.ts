import { createHash } from 'node:crypto';

import {
  DVIDS_ASR_HUMAN_REVIEW_DRAFT_VERSION,
  verifyDvidsAsrHumanReviewAssignment,
} from './dvidsAsrHumanReview';

export const DVIDS_ASR_HUMAN_REVIEW_WORKBOOK_VERSION =
  'case-vortex-dvids-asr-human-review-workbook-v1' as const;

const inlineJson = (value: unknown) => JSON.stringify(value)
  .replace(/</gu, '\\u003c')
  .replace(/\u2028/gu, '\\u2028')
  .replace(/\u2029/gu, '\\u2029');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export const buildDvidsAsrReviewWorkbook = (params: {
  assignment: unknown;
  audioClips: ReadonlyMap<string, Buffer>;
}) => {
  const assignment = verifyDvidsAsrHumanReviewAssignment(params.assignment);
  if (params.audioClips.size !== assignment.items.length) {
    throw new Error('dvids_asr_review_workbook_clip_accounting_invalid');
  }
  const clips = Object.fromEntries(assignment.items.map((item) => {
    const body = params.audioClips.get(item.itemId);
    if (!body || body.byteLength < 44 || body.byteLength > 64 * 1024 * 1024) {
      throw new Error('dvids_asr_review_workbook_clip_invalid');
    }
    return [item.itemId, {
      sha256: sha256(body),
      source: `data:audio/wav;base64,${body.toString('base64')}`,
    }];
  }));
  const bootstrap = inlineJson({
    workbookVersion: DVIDS_ASR_HUMAN_REVIEW_WORKBOOK_VERSION,
    draftVersion: DVIDS_ASR_HUMAN_REVIEW_DRAFT_VERSION,
    assignment,
    clips,
  });
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; media-src data:; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Case Vortex — ASR transcript review</title>
<style>
:root{color-scheme:dark;--bg:#071018;--panel:#0d1a24;--line:#29404f;--text:#eef6fb;--muted:#9db0bd;--accent:#74d8c5;--warn:#ffc857;--danger:#ff8b8b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#122735,#071018 42rem);color:var(--text);font:16px/1.5 system-ui,sans-serif}main{width:min(1100px,calc(100% - 2rem));margin:auto;padding:2rem 0 4rem}h1,h2,p{margin:0}header{display:grid;gap:.65rem;margin-bottom:1rem}.eyebrow{color:var(--accent);font-weight:800;text-transform:uppercase;letter-spacing:.12em;font-size:.78rem}.notice{background:#211d11;border-left:3px solid var(--warn);padding:.75rem;color:#ffe7aa}.panel{background:var(--panel);border:1px solid var(--line);border-radius:1rem;padding:1rem;margin-top:1rem}.meta{display:flex;gap:.5rem 1rem;flex-wrap:wrap;color:var(--muted);overflow-wrap:anywhere}.machine{padding:.8rem;border:1px solid var(--line);background:#061019;border-radius:.6rem;font:1rem/1.5 ui-monospace,monospace}.fields,.reviewer{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:.8rem}.wide{grid-column:1/-1}label{display:grid;gap:.3rem;color:var(--muted)}button,select,input,textarea{font:inherit;color:var(--text);background:#08141d;border:1px solid var(--line);border-radius:.5rem;padding:.6rem}textarea{min-height:5rem;resize:vertical}button{cursor:pointer}.primary{background:#145245;border-color:#2a8c78;font-weight:700}.attest,.actions{display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-start;margin-top:1rem}.attest label{display:flex;flex-direction:row;color:var(--text);flex:1 1 20rem}.attest input{width:auto}.status{color:var(--muted)}.error{color:var(--danger)}audio{width:100%;margin:.8rem 0}@media(max-width:700px){main{width:calc(100% - 1rem);padding-top:1rem}.fields,.reviewer{grid-template-columns:1fr}.wide{grid-column:auto}}
</style></head><body><main>
<header><div class="eyebrow">Case Vortex · exact checksum-bound media intervals</div><h1>ASR transcript human review</h1><p>Listen to each exact recovered interval, then accept the machine text exactly, correct it, or reject it.</p><p class="notice">A reviewed transcript is not an event claim, object identity, or independent verification. This offline workbook cannot access the network, create claims, or authorize publication.</p></header>
<section class="panel"><div class="reviewer"><label>Reviewer ID<input id="reviewer-id" autocomplete="off"></label><label>Completed at<input id="reviewed-at" type="datetime-local" step="1"></label></div><div class="attest"><label><input id="human" type="checkbox">I personally performed every review.</label><label><input id="intervals" type="checkbox">I listened to each exact checksum-bound media interval.</label><label><input id="origin" type="checkbox">I preserved every timecode and machine-ASR origin.</label><label><input id="limits" type="checkbox">I imply no event claim or identity.</label></div></section>
<section id="items"></section><section class="panel"><div class="actions"><button id="export" class="primary" type="button">Export completed draft</button><span id="status" class="status" role="status"></span></div></section>
</main><script id="bootstrap" type="application/json">${bootstrap}</script><script>
(()=>{'use strict';const boot=JSON.parse(document.getElementById('bootstrap').textContent),a=boot.assignment,el=id=>document.getElementById(id),root=el('items'),esc=value=>String(value);for(const [index,item] of a.items.entries()){const card=document.createElement('section');card.className='panel';card.dataset.index=String(index);const h=document.createElement('h2');h.textContent='Review interval '+(index+1)+' of '+a.items.length;const meta=document.createElement('div');meta.className='meta';meta.textContent=item.address+' · '+item.startMs+'–'+item.endMs+' ms · machine text SHA-256 '+item.machineTextSha256;const audio=document.createElement('audio');audio.controls=true;audio.src=boot.clips[item.itemId].source;audio.setAttribute('aria-label','Exact recovered audio interval');const machine=document.createElement('p');machine.className='machine';machine.textContent='Machine ASR: '+item.machineText+' · confidence '+item.machineConfidence;const fields=document.createElement('div');fields.className='fields';fields.innerHTML='<label>Decision<select data-k="decision"><option value="">Choose…</option><option value="exact">Machine transcript is exact</option><option value="corrected">Correct transcript</option><option value="rejected">Reject as inaccurate/noise</option></select></label><label>Confidence<select data-k="confidence"><option value="">Choose…</option><option>low</option><option>medium</option><option>high</option></select></label><label class="wide">Corrected transcript<textarea data-k="corrected" placeholder="Required only when correcting"></textarea></label><label class="wide">Rationale<textarea data-k="rationale" maxlength="2000" placeholder="At least 12 characters"></textarea></label>';card.append(h,meta,audio,machine,fields);root.append(card);const decision=card.querySelector('[data-k="decision"]'),corrected=card.querySelector('[data-k="corrected"]');decision.onchange=()=>{corrected.disabled=decision.value!=='corrected';if(corrected.disabled)corrected.value=''};decision.onchange()}
const reviewedAt=()=>{const value=el('reviewed-at').value;if(!value)return null;const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString():null};el('export').onclick=()=>{const att={humanPerformed:el('human').checked||null,listenedToExactChecksumBoundMediaIntervals:el('intervals').checked||null,preservedTimecodeAndMachineOrigin:el('origin').checked||null,noEventClaimOrIdentityImplied:el('limits').checked||null};const reviews=a.items.map((item,index)=>{const card=root.querySelector('[data-index="'+index+'"]'),value=k=>card.querySelector('[data-k="'+k+'"]').value.trim()||null;return{itemId:item.itemId,decision:value('decision'),correctedText:value('corrected'),confidence:value('confidence'),rationale:value('rationale')}}),valid=reviews.every(review=>review.decision&&review.confidence&&review.rationale&&review.rationale.length>=12&&((review.decision==='corrected'&&review.correctedText&&review.correctedText!==a.items.find(item=>item.itemId===review.itemId).machineText)||(review.decision!=='corrected'&&!review.correctedText)))&&Object.values(att).every(value=>value===true)&&el('reviewer-id').value.trim().length>=3&&reviewedAt();if(!valid){el('status').textContent='Complete every interval, correction rule, rationale, reviewer detail and attestation.';el('status').className='status error';return}const draft={recordType:'dvids_asr_human_review_draft',schemaVersion:boot.draftVersion,assignmentDigest:a.assignmentDigest,reviewerId:el('reviewer-id').value.trim().toLowerCase(),reviewedAt:reviewedAt(),attestation:att,reviews};const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)+'\\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='dvids-asr-review-completed.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);el('status').textContent='Completed draft exported for fail-closed sealing.';el('status').className='status'}})();
</script></body></html>`;
};
