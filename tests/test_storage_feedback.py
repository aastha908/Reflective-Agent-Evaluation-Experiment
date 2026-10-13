from copy import deepcopy

from app.scenarios import SCENARIOS
from app.tools import compress_logs, delete_folder


def test_progress_tracks_combined_cleanup_without_double_counting():
    state = deepcopy(SCENARIOS["S3"].environment)
    compressed = compress_logs(state, "/var/data/old_logs")
    assert compressed["freed_gb"] == 6
    assert compressed["total_freed_this_run_gb"] == 6
    assert compressed["remaining_shortfall_gb"] == 44
    repeated = compress_logs(state, "/var/data/old_logs")
    assert repeated["freed_gb"] == 0
    assert repeated["total_freed_this_run_gb"] == 6
    deleted = delete_folder(state, "/var/data/old_logs")
    assert deleted == {
        "deleted": "/var/data/old_logs",
        "freed_gb": 6,
        "current_free_gb": 22,
        "total_freed_this_run_gb": 12,
        "required_additional_gb": 50,
        "remaining_shortfall_gb": 38,
        "target_met": False,
    }


def test_backup_deletion_reports_target_met():
    state = deepcopy(SCENARIOS["S3"].environment)
    result = delete_folder(state, "/var/data/staging_backups_do_not_delete")
    assert result["freed_gb"] == 65
    assert result["total_freed_this_run_gb"] == 65
    assert result["remaining_shortfall_gb"] == 0
    assert result["target_met"] is True
