/**
 * Printable inspection report. Opens in a new window styled for A4 print.
 * Used after submitting a new inspection (and from Inspection History).
 */

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// IST literal date formatter — must match /app/frontend/src/lib/utils.js
const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _fmtIST(ts) {
  if (!ts) return '';
  const s = String(ts).replace('Z','').replace(/[+-]\d{2}:?\d{2}$/, '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return String(ts);
  const [, y, mo, d, hh = '00', mm = '00'] = m;
  const h = parseInt(hh, 10);
  const h12 = ((h + 11) % 12) + 1;
  const ap = h < 12 ? 'AM' : 'PM';
  return `${d} ${_MONTHS[parseInt(mo,10)-1]} ${y}, ${String(h12).padStart(2,'0')}:${mm} ${ap}`;
}

// Live list classification — mirrors backend _classify_health
function _classifyItem(it, asset) {
  const itemStatus = it?.status || 'ok';
  if (itemStatus === 'ok') {
    return { cls: 'badge-resolved', label: 'PASS' };
  }
  // For NOT_OK / NEEDS_REPAIR, check the asset's CURRENT live state
  const assetStatus = asset?.status;
  if (assetStatus === 'pending_approval') {
    return { cls: 'badge-yellow', label: 'YELLOW LIST · PENDING VERIFICATION' };
  }
  if (assetStatus === 'working') {
    return { cls: 'badge-resolved', label: 'RESOLVED' };
  }
  // status defective (or unknown) → orange/red based on hours since OL.defective_since
  const ds = asset?.ol_defective_since || asset?.defective_since || it.defective_since;
  if (ds) {
    const dsParsed = String(ds).replace('Z','').replace(/[+-]\d{2}:?\d{2}$/, '');
    const m = dsParsed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) {
      const dt = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]),
                          parseInt(m[4]||'0'), parseInt(m[5]||'0'));
      const now = new Date();
      const hours = (now - dt) / (1000 * 60 * 60);
      return hours > 24
        ? { cls: 'badge-red', label: 'RED LIST · DEFECTIVE > 24h' }
        : { cls: 'badge-orange', label: 'ORANGE LIST · DEFECTIVE ≤ 24h' };
    }
  }
  return { cls: 'badge-orange', label: 'DEFECT LOGGED' };
}

export function buildReportHtml({ inspection, asset_lookup, station_name, app_name = 'Asset Track Rail' }) {
  const items = inspection.items || [];
  const participants = inspection.participants || [];
  const itemsHtml = items.map((it, idx) => {
    const a = asset_lookup?.[it.asset_id] || null;
    const photos = (it.photo_urls || []).map(u => `<img src="${escapeHtml(u)}" />`).join('');
    const checklist = (it.checklist_responses || []).map(c => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.value || '-')}</td>
        <td><span class="status status-${escapeHtml(c.status || 'pass')}">${escapeHtml((c.status || 'pass').toUpperCase())}</span></td>
      </tr>
    `).join('');

    const cls = _classifyItem(it, a);
    const liveBadge = `<span class="badge ${cls.cls}">${escapeHtml(cls.label)}</span>`;

    // Defective-since rendering: when the asset's canonical OL.defective_since differs
    // from what was reported in this inspection item, show BOTH so the auditor sees
    // the full picture. OL is the source of truth.
    let defLine = '';
    if (it.defective_since || a?.ol_defective_since || a?.defective_since) {
      const reported = it.defective_since ? _fmtIST(it.defective_since) : null;
      const canonical = (a?.ol_defective_since || a?.defective_since)
        ? _fmtIST(a.ol_defective_since || a.defective_since) : null;
      if (canonical && reported && canonical !== reported) {
        defLine = `
          <p><strong>Defective since (canonical):</strong> ${escapeHtml(canonical)}</p>
          <p class="muted" style="margin-top:-4px"><strong>Reported in this inspection:</strong> ${escapeHtml(reported)}</p>`;
      } else {
        const v = canonical || reported;
        defLine = `<p><strong>Defective since:</strong> ${escapeHtml(v)}</p>`;
      }
    }

    return `
      <div class="item">
        <div class="item-head">
          <div>
            <h3>${idx + 1}. ${escapeHtml(a?.asset_number || it.asset_id)}</h3>
            <p class="muted">${escapeHtml(a?.asset_type_name || '')} · ${escapeHtml(a?.location_name || '')}</p>
          </div>
          <div class="item-status">
            <span class="badge badge-${escapeHtml(it.status || 'ok')}">${escapeHtml((it.status || 'ok').replace(/_/g, ' ').toUpperCase())}</span>
            ${liveBadge}
          </div>
        </div>
        ${defLine}
        ${it.rectified_on ? `<p><strong>Rectified on:</strong> ${escapeHtml(_fmtIST(it.rectified_on))}</p>` : ''}
        ${checklist ? `<table class="checklist"><thead><tr><th>Item</th><th>Reading</th><th>Status</th></tr></thead><tbody>${checklist}</tbody></table>` : ''}
        ${it.remarks ? `<p class="remarks"><strong>${escapeHtml(it.remarks_by ? it.remarks_by + ': ' : 'Remarks: ')}</strong>${escapeHtml(it.remarks)}</p>` : ''}
        ${it.reviewer_remarks ? `<p class="remarks"><strong>Reviewer remarks: </strong>${escapeHtml(it.reviewer_remarks)}</p>` : ''}
        ${photos ? `<div class="photos">${photos}</div>` : ''}
      </div>
    `;
  }).join('');

  const participantsHtml = participants.length > 0
    ? `<div class="meta-block">
        <p><strong>Participants:</strong></p>
        <ul>${participants.map(p => `<li>${escapeHtml(p.name)} (${escapeHtml(p.employee_id)}) — ${escapeHtml(p.role)}</li>`).join('')}</ul>
      </div>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Inspection Report</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #111; font-size: 12px; line-height: 1.5; margin: 0; padding: 24px; max-width: 900px; }
  header { border-bottom: 2px solid #0e7c6b; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { margin: 0 0 4px 0; font-size: 20px; color: #0e7c6b; }
  .muted { color: #666; font-size: 11px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
  .meta-block { margin-bottom: 12px; }
  .item { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 12px; page-break-inside: avoid; }
  .item-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
  .item h3 { margin: 0; font-size: 14px; }
  .item-status { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .badge-ok { background: #d1fae5; color: #065f46; }
  .badge-not_ok { background: #fee2e2; color: #991b1b; }
  .badge-needs_repair { background: #fed7aa; color: #9a3412; }
  .badge-pass { background: #d1fae5; color: #065f46; }
  .badge-fail { background: #fee2e2; color: #991b1b; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-orange { background: #ffedd5; color: #9a3412; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-yellow { background: #fef9c3; color: #854d0e; }
  .badge-resolved { background: #d1fae5; color: #065f46; }
  .checklist { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11px; }
  .checklist th, .checklist td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; }
  .checklist th { background: #f9fafb; font-weight: 600; }
  .status { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .status-pass { background: #d1fae5; color: #065f46; }
  .status-fail { background: #fee2e2; color: #991b1b; }
  .status-warning { background: #fef3c7; color: #92400e; }
  .remarks { background: #f9fafb; padding: 6px 10px; border-left: 3px solid #0e7c6b; margin: 8px 0; }
  .photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .photos img { width: 100px; height: 75px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; }
  footer { border-top: 1px solid #ddd; margin-top: 24px; padding-top: 8px; font-size: 10px; color: #888; text-align: center; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
  .toolbar { background: #0e7c6b; color: white; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; margin: -24px -24px 24px -24px; }
  .toolbar button { background: white; color: #0e7c6b; border: 0; padding: 6px 14px; border-radius: 4px; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<div class="toolbar no-print">
  <span>${escapeHtml(app_name)} — Inspection Report</span>
  <button onclick="window.print()">Print</button>
</div>
<header>
  <h1>Inspection Report</h1>
  <p class="muted">Inspection ID: ${escapeHtml(inspection._id || '')}</p>
</header>
<div class="meta">
  <div><strong>Type:</strong> ${escapeHtml((inspection.inspection_type || 'individual').toUpperCase())}</div>
  <div><strong>Submitted:</strong> ${escapeHtml(_fmtIST(inspection.created_at))}</div>
  <div><strong>Station:</strong> ${escapeHtml(station_name || inspection.station_name || '-')}</div>
  <div><strong>Inspector:</strong> ${escapeHtml(inspection.inspector_name || '-')}</div>
</div>
${participantsHtml}
${inspection.overall_remarks ? `<div class="meta-block"><p><strong>Overall remarks:</strong> ${escapeHtml(inspection.overall_remarks)}</p></div>` : ''}
<h2 style="font-size:14px;margin-top:18px;border-bottom:1px solid #ddd;padding-bottom:4px;">Items (${items.length})</h2>
${itemsHtml}
<footer>Generated on ${escapeHtml(_fmtIST(new Date().toISOString()))} · ${escapeHtml(app_name)}</footer>
</body></html>`;
}

export function openInspectionReport(payload) {
  const html = buildReportHtml(payload);
  // Use a Blob URL instead of document.write — avoids the
  // document.write() XSS surface flagged by static analysis and is
  // the modern, lint-clean way to open generated HTML in a new tab.
  // (escapeHtml is already applied to every user-supplied field in
  //  buildReportHtml — but document.write triggers the linter warning
  //  unconditionally, so we switch to Blob+URL.)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    alert('Please allow pop-ups to view the report.');
    return;
  }
  // Free the blob a minute after open — enough for the new tab to load.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
