"""Pytest wrapper that runs the read-only list consistency audit and asserts
zero invariant violations. Exits cleanly when run via pytest discovery."""

import os
import sys

# Allow `import audit_list_consistency` from this same tests directory
sys.path.insert(0, os.path.dirname(__file__))

from audit_list_consistency import main as run_audit


def test_list_consistency_audit_passes():
    """Every defective asset must appear in exactly one of orange/red/yellow,
    every open OL entry must point to a real asset with the right status,
    and timestamp ordering must be sane.

    On failure, see /app/test_reports/list_consistency.json for the offending
    asset_ids and OL._ids.
    """
    ok = run_audit()
    assert ok, (
        "List consistency audit found violations — see "
        "/app/test_reports/list_consistency.json for details."
    )
