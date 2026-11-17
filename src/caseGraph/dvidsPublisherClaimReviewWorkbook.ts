import {
  DVIDS_PUBLISHER_CLAIM_REVIEW_DRAFT_VERSION,
  verifyDvidsPublisherClaimReviewAssignment,
} from './dvidsPublisherClaimReview';

export const DVIDS_PUBLISHER_CLAIM_REVIEW_WORKBOOK_VERSION =
  'case-vortex-dvids-publisher-claim-review-workbook-v1' as const;

const inlineJson = (value: unknown) => JSON.stringify(value)
  .replace(/</gu, '\\u003c')
  .replace(/\u2028/gu, '\\u2028')
  .replace(/\u2029/gu, '\\u2029');

export const buildDvidsPublisherClaimReviewWorkbook = (
  assignmentValue: unknown,
) => {
  const assignment = verifyDvidsPublisherClaimReviewAssignment(assignmentValue);
  const bootstrap = inlineJson({
    workbookVersion: DVIDS_PUBLISHER_CLAIM_REVIEW_WORKBOOK_VERSION,
    draftVersion: DVIDS_PUBLISHER_CLAIM_REVIEW_DRAFT_VERSION,
    assignment,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Case Vortex — DVIDS publisher claim review</title>
  <style>
    :root{color-scheme:dark;--bg:#071018;--panel:#0d1a24;--line:#29404f;--text:#eef6fb;--muted:#9db0bd;--accent:#74d8c5;--warn:#ffc857;--danger:#ff8b8b}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#122735,#071018 42rem);color:var(--text);font:16px/1.5 system-ui,sans-serif}
    main{width:min(1050px,calc(100% - 2rem));margin:auto;padding:2rem 0 4rem}h1,h2,p{margin:0}.eyebrow{color:var(--accent);font-weight:800;text-transform:uppercase;letter-spacing:.12em;font-size:.78rem}
    header{display:grid;gap:.65rem;margin-bottom:1rem}.notice{background:#211d11;border-left:3px solid var(--warn);padding:.75rem;color:#ffe7aa}.panel{background:var(--panel);border:1px solid var(--line);border-radius:1rem;padding:1rem}
    .toolbar,.nav,.attest,.export,.claim-actions{display:flex;gap:.7rem;flex-wrap:wrap;align-items:center}.toolbar{justify-content:space-between}.progress{flex:1;min-width:15rem}progress{width:100%;accent-color:var(--accent)}
    button,select,input,textarea{font:inherit;color:var(--text);background:#08141d;border:1px solid var(--line);border-radius:.5rem;padding:.6rem}.primary{background:#145245;border-color:#2a8c78;font-weight:700}
    button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button{cursor:pointer}label{display:grid;gap:.3rem;color:var(--muted)}
    .meta{display:flex;gap:.5rem 1rem;flex-wrap:wrap;color:var(--muted);font-size:.85rem;overflow-wrap:anywhere}.source{white-space:pre-wrap;overflow-wrap:anywhere;background:#061019;border:1px solid var(--line);padding:1rem;border-radius:.7rem;font:1rem/1.65 ui-monospace,monospace;user-select:text}
    .fields{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:.8rem}.wide{grid-column:1/-1}textarea{min-height:6rem;resize:vertical}.claims{display:grid;gap:.7rem;margin-top:1rem}.claim{border:1px solid var(--line);padding:.8rem;border-radius:.7rem}.quote{color:#d7f7ef;white-space:pre-wrap}
    .nav{justify-content:space-between;margin-top:1rem}.reviewer{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line)}.attest{align-items:flex-start;margin-top:1rem}.attest label{display:flex;flex-direction:row;color:var(--text);flex:1 1 20rem}.attest input{width:auto}
    .export{margin-top:1rem}.status{color:var(--muted)}.error{color:var(--danger)}@media(max-width:700px){main{width:calc(100% - 1rem);padding-top:1rem}.fields,.reviewer{grid-template-columns:1fr}.wide{grid-column:auto}}
  </style>
</head>
<body><main>
  <header><div class="eyebrow">Case Vortex · exact publisher text</div><h1>DVIDS publisher claim review</h1>
    <p>Review each title and description independently. Select exact text before adding a candidate claim.</p>
    <p class="notice">Publisher metadata is not a transcript, visual observation, or independent verification. Exported candidates do not authorize claim segments or publication.</p>
  </header>
  <section class="panel">
    <div class="toolbar"><div class="progress"><div id="progress-text">0 reviewed</div><progress id="progress" value="0" max="1"></progress></div><div id="position"></div></div>
    <article><h2 id="heading" tabindex="-1">Review surface</h2><div id="meta" class="meta"></div><pre id="source" class="source"></pre>
      <div class="fields">
        <label>Decision<select id="decision"><option value="">Choose…</option><option value="no_atomic_claims">No useful atomic claims</option><option value="atomic_claims_proposed">Propose atomic claims</option></select></label>
        <label>Confidence<select id="confidence"><option value="">Choose…</option><option>low</option><option>medium</option><option>high</option></select></label>
        <label class="wide">Rationale<textarea id="rationale" maxlength="2000" placeholder="At least 12 characters"></textarea></label>
      </div>
      <div class="claims"><div class="claim-actions"><button id="add-claim" type="button">Add selected quotation</button><span class="status">Select exact text above first.</span></div><div id="claim-list"></div></div>
      <div class="nav"><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></div>
    </article>
    <div class="reviewer"><label>Reviewer ID<input id="reviewer-id" autocomplete="off"></label><label>Completed at<input id="reviewed-at" type="datetime-local" step="1"></label></div>
    <div class="attest">
      <label><input id="human" type="checkbox">I personally performed this human review.</label>
      <label><input id="exact" type="checkbox">I reviewed the exact publisher text shown.</label>
      <label><input id="origin" type="checkbox">I preserved publisher-metadata origin.</label>
      <label><input id="limits" type="checkbox">I understand this implies no external verification.</label>
    </div>
    <div class="export"><button id="checkpoint" type="button">Export checkpoint</button><button id="export" class="primary" type="button">Export completed draft</button><span id="status" class="status" role="status"></span></div>
  </section>
</main>
<script id="bootstrap" type="application/json">${bootstrap}</script>
<script>
(()=>{
  'use strict';
  const boot=JSON.parse(document.getElementById('bootstrap').textContent);
  const assignment=boot.assignment,items=assignment.items,encoder=new TextEncoder();
  const state=new Map(items.map(item=>[item.itemId,{itemId:item.itemId,decision:null,confidence:null,rationale:null,claims:[]}]));
  const byId=new Map(items.map(item=>[item.itemId,item]));let index=0;
  const el=id=>document.getElementById(id),current=()=>items[index],review=()=>state.get(current().itemId);
  const save=()=>{const r=review();r.decision=el('decision').value||null;r.confidence=el('confidence').value||null;r.rationale=el('rationale').value.trim()||null;updateProgress()};
  const complete=r=>Boolean(r.decision&&r.confidence&&r.rationale&&r.rationale.length>=12&&((r.decision==='no_atomic_claims'&&r.claims.length===0)||(r.decision==='atomic_claims_proposed'&&r.claims.length>0)));
  const updateProgress=()=>{const n=[...state.values()].filter(complete).length;el('progress').max=items.length;el('progress').value=n;el('progress-text').textContent=n+' of '+items.length+' reviewed'};
  const renderClaims=()=>{const root=el('claim-list');root.replaceChildren();review().claims.forEach((claim,i)=>{const box=document.createElement('div');box.className='claim';
    const quote=document.createElement('div');quote.className='quote';quote.textContent='“'+claim.exactQuote+'” · bytes '+claim.quoteStartByte+'–'+claim.quoteEndByte;
    const normalized=document.createElement('textarea');normalized.placeholder='Atomic normalized claim';normalized.value=claim.normalizedClaim;normalized.oninput=()=>claim.normalizedClaim=normalized.value;
    const attribution=document.createElement('input');attribution.placeholder='Attribution';attribution.value=claim.attribution;attribution.oninput=()=>claim.attribution=attribution.value;
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove claim';remove.onclick=()=>{review().claims.splice(i,1);renderClaims();updateProgress()};
    box.append(quote,normalized,attribution,remove);root.append(box)})};
  const render=()=>{const item=current(),r=review();el('position').textContent=(index+1)+' / '+items.length;el('meta').textContent=item.address+' · '+item.sourceField+' · '+item.sourceTextSha256;el('source').textContent=item.sourceText;el('decision').value=r.decision||'';el('confidence').value=r.confidence||'';el('rationale').value=r.rationale||'';renderClaims();updateProgress();el('heading').focus()};
  const rangeOffsets=()=>{const selection=getSelection();if(!selection||selection.rangeCount!==1||selection.isCollapsed)return null;const range=selection.getRangeAt(0),source=el('source');if(!source.contains(range.commonAncestorContainer))return null;
    const before=document.createRange();before.selectNodeContents(source);before.setEnd(range.startContainer,range.startOffset);const exact=range.toString();if(!exact)return null;const start=encoder.encode(before.toString()).length;return{quoteStartByte:start,quoteEndByte:start+encoder.encode(exact).length,exactQuote:exact}};
  el('add-claim').onclick=()=>{save();const span=rangeOffsets();if(!span){el('status').textContent='Select an exact quotation inside the source text.';el('status').className='status error';return}review().claims.push({...span,normalizedClaim:'',attribution:'DVIDS publisher metadata'});el('decision').value='atomic_claims_proposed';review().decision='atomic_claims_proposed';getSelection().removeAllRanges();renderClaims();updateProgress()};
  ['decision','confidence','rationale'].forEach(id=>el(id).addEventListener('change',save));
  el('previous').onclick=()=>{save();index=Math.max(0,index-1);render()};el('next').onclick=()=>{save();index=Math.min(items.length-1,index+1);render()};
  const reviewedAt=()=>{const value=el('reviewed-at').value;if(!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null};
  const draft=()=>({recordType:'dvids_publisher_claim_review_draft',schemaVersion:boot.draftVersion,assignmentDigest:assignment.assignmentDigest,reviewerId:el('reviewer-id').value.trim().toLowerCase()||null,reviewedAt:reviewedAt(),attestation:{humanPerformed:el('human').checked||null,reviewedExactPublisherText:el('exact').checked||null,preservedPublisherMetadataOrigin:el('origin').checked||null,noExternalVerificationImplied:el('limits').checked||null},reviews:items.map(item=>state.get(item.itemId))});
  const download=(value,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0)};
  el('checkpoint').onclick=()=>{save();download(draft(),'dvids-publisher-claim-review-checkpoint.json')};
  el('export').onclick=()=>{save();const value=draft(),all=[...state.values()].every(r=>complete(r)&&r.claims.every(c=>c.normalizedClaim.trim().length>=3&&c.attribution.trim().length>=3));const att=Object.values(value.attestation).every(v=>v===true);
    if(!all||!value.reviewerId||!value.reviewedAt||!att){el('status').textContent='Complete all 34 reviews, candidate fields, reviewer details and attestations.';el('status').className='status error';return}download(value,'dvids-publisher-claim-review-completed.json');el('status').textContent='Completed draft exported for fail-closed sealing.';el('status').className='status'};
  render();
})();
</script></body></html>`;
};
