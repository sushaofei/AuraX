"""Boundary tests: only selected summary fields may leave the private evaluator."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "deploy"))
from evaluation_reports import Report, export_run


def raw_run(tmp_path):
    root = tmp_path / ("eval_" + "a" * 32)
    root.mkdir()
    config = dict(benchmark="tau-bench", split="dev", model="test-model", harness_revision="a" * 40,
                  dataset_revision="sha256:" + "b" * 64, max_actions=30, max_output_tokens=24576,
                  per_turn_output_tokens=4096, timeout_seconds=600, seed=10, domain="retail")
    (root / "manifest.json").write_text(json.dumps(dict(config=config, task_ids=["0", "1"], trials=1,
                                                        model_gateway_url="http://private-host")))
    for i in range(2):
        record = dict(config=config, task_id=str(i), trial=0, status="completed", success=i == 0,
                      official_reward=1 if i == 0 else 0, elapsed_seconds=10, model_calls=2, tool_calls=2,
                      dataset_revision_verified=True, validation_scope="official-sdk-adapter", upstream_revision="c" * 40,
                      private_task="NEVER-PUBLISH", usage={"token": "NEVER-PUBLISH"}, error_type="NEVER-PUBLISH")
        (root / f"attempt_{i:06d}.json").write_text(json.dumps(record))
    # Intentionally invalid JSON: exporter must not even open trace files.
    (root / "attempt_000000.trace.json").write_text("NEVER-PUBLISH")
    return root


def test_export_projects_allowlist_without_opening_trace(tmp_path):
    run = export_run(raw_run(tmp_path))
    assert [a.success for a in run.attempts] == [True, False]
    assert run.total_cost is None
    assert "NEVER-PUBLISH" not in run.model_dump_json()
    assert "private-host" not in run.model_dump_json()


@pytest.mark.parametrize("change", ["duplicate", "config", "reward", "scope", "foreign"])
def test_rejects_invalid_or_mixed_records(tmp_path, change):
    root = raw_run(tmp_path)
    path = root / "attempt_000001.json"
    record = json.loads(path.read_text())
    if change == "duplicate": record["task_id"] = "0"
    if change == "config": record["config"]["model"] = "other"
    if change == "reward": record["official_reward"] = float("nan")
    if change == "scope": record["validation_scope"] = "fixture"
    if change == "foreign": record["task_id"] = "not-selected"
    path.write_text(json.dumps(record))
    with pytest.raises(ValueError):
        export_run(root)


def test_missing_attempt_retains_manifest_denominator(tmp_path):
    root = raw_run(tmp_path)
    (root / "attempt_000001.json").unlink()
    run = export_run(root)
    assert len(run.attempts) == 1
    assert len(run.task_ids) * run.trials == 2


def test_omitted_manifest_defaults_match_explicit_record_defaults(tmp_path):
    root = raw_run(tmp_path)
    for path in root.glob("attempt_*.json"):
        if path.name.endswith(".trace.json"):
            continue
        value = json.loads(path.read_text())
        value["config"].update(user_model=None, user_provider=None)
        path.write_text(json.dumps(value))
    assert len(export_run(root).attempts) == 2
