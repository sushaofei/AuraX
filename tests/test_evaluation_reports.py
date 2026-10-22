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
    config = dict(
        benchmark="tau-bench",
        split="dev",
        model="test-model",
        harness_revision="a" * 40,
        dataset_revision="sha256:" + "b" * 64,
        max_actions=30,
        max_output_tokens=24576,
        per_turn_output_tokens=4096,
        timeout_seconds=600,
        seed=10,
        domain="retail",
    )
    (root / "manifest.json").write_text(
        json.dumps(
            dict(
                config=config,
                task_ids=["0", "1"],
                trials=1,
                model_gateway_url="http://private-host",
            )
        )
    )
    for i in range(2):
        record = dict(
            config=config,
            task_id=str(i),
            trial=0,
            status="completed",
            success=i == 0,
            official_reward=1 if i == 0 else 0,
            elapsed_seconds=10,
            model_calls=2,
            tool_calls=2,
            dataset_revision_verified=True,
            validation_scope="official-sdk-adapter",
            upstream_revision="c" * 40,
            private_task="NEVER-PUBLISH",
            usage={"token": "NEVER-PUBLISH"},
            error_type="NEVER-PUBLISH",
        )
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


@pytest.mark.parametrize(
    "change", ["duplicate", "config", "reward", "scope", "foreign"]
)
def test_rejects_invalid_or_mixed_records(tmp_path, change):
    root = raw_run(tmp_path)
    path = root / "attempt_000001.json"
    record = json.loads(path.read_text())
    if change == "duplicate":
        record["task_id"] = "0"
    if change == "config":
        record["config"]["model"] = "other"
    if change == "reward":
        record["official_reward"] = float("nan")
    if change == "scope":
        record["validation_scope"] = "fixture"
    if change == "foreign":
        record["task_id"] = "not-selected"
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


def e3_world(root):
    manifest = json.loads((root / "manifest.json").read_text())
    manifest.update(
        protocol="e3-heldout-v1",
        task_ids=["family_1", "family_2", "family_3"],
        trials=3,
    )
    manifest["config"].update(benchmark="appworld", domain=None)
    (root / "manifest.json").write_text(json.dumps(manifest))
    for i, (task, trial) in enumerate(
        (t, k) for t in manifest["task_ids"] for k in range(3)
    ):
        r = dict(
            config=manifest["config"],
            task_id=task,
            trial=trial,
            status="completed",
            success=not task.endswith("3"),
            official_reward=0 if task.endswith("3") else 1,
            elapsed_seconds=10,
            model_calls=2,
            tool_calls=2,
            dataset_revision_verified=True,
            validation_scope="official-sdk-adapter",
            upstream_revision="c" * 40,
        )
        (root / f"attempt_{i:06d}.json").write_text(json.dumps(r))
    receipt = dict(
        verified=True,
        trials=[
            dict(
                trial=t,
                tasks=3,
                scenarios=1,
                task_goal_completion=0.667,
                scenario_goal_completion=0,
            )
            for t in range(3)
        ],
    )
    receipt.update(
        verification_basis="two-post-close-official-graders",
        verifier_revision="a" * 40,
        episode_success_adjustments=0,
        regraded_rewards=[
            dict(task_id=t, trial=k, reward=0 if t.endswith("3") else 1)
            for t in manifest["task_ids"]
            for k in range(3)
        ],
    )
    (root / "official-metrics.json").write_text(json.dumps(receipt))
    return receipt


def test_e3_official_scene_regrade_must_match_recorded_rewards(tmp_path):
    root = raw_run(tmp_path)
    receipt = e3_world(root)
    run = export_run(root)
    assert run.protocol == "e3-heldout-v1" and len(run.official_metrics) == 3
    receipt["trials"][0]["scenario_goal_completion"] = 1
    (root / "official-metrics.json").write_text(json.dumps(receipt))
    with pytest.raises(ValueError, match="disagrees"):
        export_run(root)


def test_e3_does_not_accept_unverified_grading_receipts(tmp_path):
    root = raw_run(tmp_path)
    receipt = e3_world(root)
    receipt["verified"] = False
    (root / "official-metrics.json").write_text(json.dumps(receipt))
    with pytest.raises(ValueError, match="not verified"):
        export_run(root)


def test_independent_regrade_preserves_runtime_error_and_unknown_primary_reward(
    tmp_path,
):
    root = raw_run(tmp_path)
    receipt = e3_world(root)
    rewards = []
    for path in root.iterdir():
        if path.name.endswith(".trace.json") or not path.name.startswith("attempt_"):
            continue
        value = json.loads(path.read_text())
        rewards.append(
            dict(
                task_id=value["task_id"],
                trial=value["trial"],
                reward=value["official_reward"],
            )
        )
        if value["task_id"] == "family_3" and value["trial"] == 2:
            value.update(
                status="runtime_error",
                official_reward=None,
                error_type="ModelProviderError",
            )
            path.write_text(json.dumps(value))
    receipt["regraded_rewards"] = rewards
    (root / "official-metrics.json").write_text(json.dumps(receipt))
    run = export_run(root)
    failed = next(a for a in run.attempts if a.status == "runtime_error")
    assert (
        failed.official_reward is None
        and failed.independent_reward == 0
        and not failed.success
    )
    assert run.official_metrics[2].scenario_goal_completion == 0


def test_post_close_final_judgments_correct_only_the_published_projection(tmp_path):
    root = raw_run(tmp_path)
    receipt = e3_world(root)
    rewards = []
    for path in root.iterdir():
        if path.name.endswith(".trace.json") or not path.name.startswith("attempt_"):
            continue
        row = json.loads(path.read_text())
        rewards.append(
            dict(
                task_id=row["task_id"],
                trial=row["trial"],
                reward=row["official_reward"],
            )
        )
        row.update(success=True, official_reward=1)
        path.write_text(json.dumps(row))
    receipt.update(
        verification_basis="two-post-close-official-graders",
        verifier_revision="a" * 40,
        episode_success_adjustments=3,
        regraded_rewards=rewards,
    )
    (root / "official-metrics.json").write_text(json.dumps(receipt))
    before = {p.name: p.read_bytes() for p in root.glob("attempt_*.json")}
    run = export_run(root)
    assert run.scoring_basis == "post-close-official" and run.scoring_adjustments == 3
    assert sum(a.success for a in run.attempts) == 6
    assert all(a.episode_success for a in run.attempts)
    assert before == {p.name: p.read_bytes() for p in root.glob("attempt_*.json")}


def test_e3_appworld_live_diagnostics_are_never_published_as_final_results(tmp_path):
    root = raw_run(tmp_path)
    e3_world(root)
    (root / "official-metrics.json").unlink()
    with pytest.raises(ValueError, match="finalized post-close"):
        export_run(root)
