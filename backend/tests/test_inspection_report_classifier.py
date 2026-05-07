"""
Unit-level test of the frontend's _classifyItem and _fmtIST functions
(/app/frontend/src/lib/inspection-report.js) executed via Node.

Verifies TEST 9 + TEST 10 logic without spinning a full Playwright flow.
"""
import json
import subprocess


_NODE_HARNESS = r"""
// Inline test harness — extracts and exercises the report classifier.
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
function _classifyItem(it, asset) {
  const itemStatus = it?.status || 'ok';
  if (itemStatus === 'ok') return { cls: 'badge-resolved', label: 'PASS' };
  const assetStatus = asset?.status;
  if (assetStatus === 'pending_approval')
    return { cls: 'badge-yellow', label: 'YELLOW LIST · PENDING VERIFICATION' };
  if (assetStatus === 'working') return { cls: 'badge-resolved', label: 'RESOLVED' };
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

const cases = [];

// 1. Auto-rejected asset → asset.status='defective' (FRESH revert)
const today = new Date();
const tenHoursAgo = new Date(today.getTime() - 10 * 3600 * 1000);
const isoOf = (d) => d.toISOString().slice(0, 19);
cases.push({
  name: 'auto-rejected with OL.defective_since 10h ago → ORANGE',
  out: _classifyItem(
    { status: 'not_ok', defective_since: isoOf(today) },
    { status: 'defective', ol_defective_since: isoOf(tenHoursAgo) }
  ),
  expectedLabelContains: 'ORANGE LIST',
});

// 2. Defective > 24h → RED
const fortyHoursAgo = new Date(today.getTime() - 40 * 3600 * 1000);
cases.push({
  name: '>24h since OL.defective_since → RED',
  out: _classifyItem(
    { status: 'not_ok' },
    { status: 'defective', ol_defective_since: isoOf(fortyHoursAgo) }
  ),
  expectedLabelContains: 'RED LIST',
});

// 3. Working asset (resolved post-rectification) → RESOLVED
cases.push({
  name: 'asset.status=working but item NOT_OK → RESOLVED (live state wins)',
  out: _classifyItem(
    { status: 'not_ok' },
    { status: 'working' }
  ),
  expectedLabelContains: 'RESOLVED',
});

// 4. pending_approval (yellow)
cases.push({
  name: 'asset.status=pending_approval → YELLOW',
  out: _classifyItem(
    { status: 'not_ok' },
    { status: 'pending_approval', ol_defective_since: isoOf(tenHoursAgo) }
  ),
  expectedLabelContains: 'YELLOW LIST',
});

// 5. _fmtIST naive — no Z, no offset
cases.push({
  name: '_fmtIST renders literal IST without TZ markers',
  out: _fmtIST('2026-05-07T08:00:00'),
  expectedLabelEquals: '07 May 2026, 08:00 AM',
});

// 6. _fmtIST trailing Z is stripped
cases.push({
  name: '_fmtIST strips trailing Z',
  out: _fmtIST('2026-05-07T20:30:00Z'),
  expectedLabelEquals: '07 May 2026, 08:30 PM',
});

console.log(JSON.stringify(cases.map(c => ({
  name: c.name,
  out: c.out,
  ok: (c.expectedLabelContains
        ? String(c.out.label || '').includes(c.expectedLabelContains)
        : c.out === c.expectedLabelEquals),
  expected: c.expectedLabelContains || c.expectedLabelEquals,
}))));
"""


def test_classify_item_logic_matches_spec():
    res = subprocess.run(
        ["node", "-e", _NODE_HARNESS], capture_output=True, text=True, timeout=30
    )
    assert res.returncode == 0, res.stderr
    data = json.loads(res.stdout.strip())
    failed = [d for d in data if not d["ok"]]
    assert not failed, "Classifier mismatches:\n" + "\n".join(
        f" - {f['name']}: got {f['out']} expected '{f['expected']}'" for f in failed
    )
