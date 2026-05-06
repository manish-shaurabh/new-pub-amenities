/**
 * Printable inspection report. Opens in a new window styled for A4 print.
 * Used after submitting a new inspection (and from Inspection History).
 */

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function buildReportHtml({ inspection, asset_lookup, station_name, app_name = 'Asset Track Rail' }) {
  const created = inspection.created_at ? new Date(inspection.created_at) : new Date();
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
    const approval = it.approval_status === 'approved' ? '<span class="badge badge-pass">PASSED</span>'
                   : it.approval_status === 'rejected' ? '<span class="badge badge-fail">FAILED</span>'
                   : '<span class="badge badge-pending">PENDING APPROVAL</span>';
    return `
      <div class="item">
        <div class="item-head">
          <div>
            <h3>${idx + 1}. ${escapeHtml(a?.asset_number || it.asset_id)}</h3>
            <p class="muted">${escapeHtml(a?.asset_type_name || '')} · ${escapeHtml(a?.location_name || '')}</p>
          </div>
          <div class="item-status">
            <span class="badge badge-${escapeHtml(it.status || 'ok')}">${escapeHtml((it.status || 'ok').replace(/_/g, ' ').toUpperCase())}</span>
            ${approval}
          </div>
        </div>
        ${it.defective_since ? `<p><strong>Defective since:</strong> ${new Date(it.defective_since).toLocaleString('en-IN')}</p>` : ''}
        ${it.rectified_on ? `<p><strong>Rectified on:</strong> ${new Date(it.rectified_on).toLocaleString('en-IN')}</p>` : ''}
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
  <div><strong>Submitted:</strong> ${created.toLocaleString('en-IN')}</div>
  <div><strong>Station:</strong> ${escapeHtml(station_name || inspection.station_name || '-')}</div>
  <div><strong>Inspector:</strong> ${escapeHtml(inspection.inspector_name || '-')}</div>
</div>
${participantsHtml}
${inspection.overall_remarks ? `<div class="meta-block"><p><strong>Overall remarks:</strong> ${escapeHtml(inspection.overall_remarks)}</p></div>` : ''}
<h2 style="font-size:14px;margin-top:18px;border-bottom:1px solid #ddd;padding-bottom:4px;">Items (${items.length})</h2>
${itemsHtml}
<footer>Generated on ${new Date().toLocaleString('en-IN')} · ${escapeHtml(app_name)}</footer>
</body></html>`;
}

export function openInspectionReport(payload) {
  const html = buildReportHtml(payload);
  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups to view the report.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Slight delay to ensure rendering before print prompt (manual via toolbar)
}
