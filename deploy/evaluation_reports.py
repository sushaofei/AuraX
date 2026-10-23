"""Publish allowlisted benchmark artifacts; never read trace files or serve raw records.

Run on the evaluation host, explicitly selecting each run directory. No model calls.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Count = Annotated[int, Field(strict=True, ge=0)]
Positive = Annotated[int, Field(strict=True, gt=0)]
Number = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_.:/+-]{1,160}$")]
Revision = Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]


class PublicModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Config(PublicModel):
    benchmark: Identifier
    split: Identifier
    model: Identifier
    harness_revision: Revision
    dataset_revision: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    max_actions: Positive
    max_output_tokens: Positive
    per_turn_output_tokens: Positive
    timeout_seconds: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    seed: Count
    user_model: Identifier | None = None
    user_provider: Identifier | None = None
    domain: Identifier | None = None


class Attempt(PublicModel):
    task_id: Identifier
    trial: Count
    status: Literal[
        "completed",
        "incomplete",
        "budget_exhausted",
        "infra_error",
        "runtime_error",
        "evaluation_error",
        "timeout",
    ]
    success: bool = Field(strict=True)
    episode_success: bool | None = Field(default=None, strict=True)
    official_reward: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)] | None
    independent_reward: (
        Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)] | None
    ) = None
    elapsed_seconds: Number | None
    model_calls: Count | None
    tool_calls: Count | None
    dataset_revision_verified: bool = Field(strict=True)

    @model_validator(mode="after")
    def consistent_success(self):
        if self.independent_reward not in {None, 0, 1}:
            raise ValueError("Independent task goal grade must be binary")
        goal = (
            self.independent_reward
            if self.independent_reward is not None
            else self.official_reward
        )
        if self.success and (self.status != "completed" or goal != 1):
            raise ValueError("Inconsistent successful attempt")
        return self


class OfficialTrial(PublicModel):
    trial: Count
    tasks: Positive
    scenarios: Positive
    task_goal_completion: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    scenario_goal_completion: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class ComponentProtocol(PublicModel):
    condition: Literal["no-memory", "retrieval-memory", "full-history", "without-skill", "with-skill", "gateway-tools"]
    judge_model: Identifier | None = None
    judge_scope: Literal["custom-judge-not-official-comparable", "official-verifier"]
    reference_memory: bool = Field(strict=True)
    reference_skills: bool = Field(strict=True)
    development_exposed_tasks: list[Identifier] = Field(default_factory=list)
    task_timeouts: dict[Identifier, Annotated[float, Field(gt=0, allow_inf_nan=False)]]


class Run(PublicModel):
    run_id: Annotated[str, Field(pattern=r"^eval_[a-f0-9]{32}$")]
    protocol: Literal["e3-heldout-v1", "auraclaw-components-v1"] | None = None
    component: ComponentProtocol | None = None
    official_metrics: list[OfficialTrial] | None = None
    scoring_basis: Literal["episode", "post-close-official"] = "episode"
    scoring_adjustments: Count = 0
    verifier_revision: Revision | None = None
    scope: Literal["development"]
    validation_scope: Literal["official-sdk-adapter", "fixture", "reference-adapter"]
    model_snapshot_verified: Literal[False]
    config: Config
    harness_profile: Identifier
    upstream_revision: Revision | None
    task_ids: list[Identifier] = Field(min_length=1, max_length=100000)
    trials: Positive
    attempts: list[Attempt] = Field(max_length=100000)
    # Total cost (including simulator) is unavailable in the current runner.
    total_cost: None = None

    @model_validator(mode="after")
    def consistent_attempts(self):
        if len(set(self.task_ids)) != len(self.task_ids):
            raise ValueError("Duplicate expected tasks")
        identities = set()
        for a in self.attempts:
            key = (a.task_id, a.trial)
            if (
                a.task_id not in self.task_ids
                or a.trial >= self.trials
                or key in identities
            ):
                raise ValueError("Unexpected or duplicate attempt")
            identities.add(key)
        if self.protocol == "e3-heldout-v1" and (self.config.split != "dev" or self.trials != 3):
            raise ValueError("Invalid E3 protocol")
        if (
            self.protocol == "e3-heldout-v1"
            and self.config.benchmark == "appworld"
            and self.scoring_basis != "post-close-official"
        ):
            raise ValueError(
                "E3 AppWorld requires finalized post-close official scores"
            )
        if self.protocol == "auraclaw-components-v1":
            if self.component is None or self.trials != 3 or len(self.attempts) != len(self.task_ids) * 3:
                raise ValueError("Component publication requires a complete controlled batch")
            allowed = {"longmemeval": {"no-memory", "retrieval-memory", "full-history"},
                       "skillsbench": {"without-skill", "with-skill"}, "mcp-universe": {"gateway-tools"}}
            c = self.component
            if c.condition not in allowed.get(self.config.benchmark, set()):
                raise ValueError("Component condition does not match benchmark")
            if set(c.task_timeouts) != set(self.task_ids) or not set(c.development_exposed_tasks) <= set(self.task_ids):
                raise ValueError("Invalid component task coverage")
            if self.config.benchmark == "longmemeval":
                if c.judge_model is None or c.judge_scope != "custom-judge-not-official-comparable" or self.validation_scope != "reference-adapter":
                    raise ValueError("LongMemEval requires explicit custom judge and reference scope")
            elif c.judge_scope != "official-verifier" or c.judge_model is not None or self.validation_scope != "official-sdk-adapter":
                raise ValueError("Official verifier provenance required")
            if c.reference_memory != (c.condition == "retrieval-memory") or c.reference_skills != (c.condition == "with-skill"):
                raise ValueError("Reference component attribution mismatch")
        elif self.component is not None or self.validation_scope == "reference-adapter":
            raise ValueError("Component metadata requires component protocol")
        if self.scoring_basis == "episode" and any(
            a.independent_reward is not None
            and a.official_reward is not None
            and a.independent_reward != a.official_reward
            for a in self.attempts
        ):
            raise ValueError("Independent grading disagrees with recorded reward")
        if self.scoring_basis == "post-close-official":
            if (
                self.official_metrics is None
                or self.verifier_revision is None
                or any(
                    a.independent_reward is None or a.episode_success is None
                    for a in self.attempts
                )
            ):
                raise ValueError("Final judgments require complete official provenance")
            if self.scoring_adjustments != sum(
                a.episode_success != a.success for a in self.attempts
            ):
                raise ValueError("Incorrect scoring adjustment count")
            if any(
                a.success != (a.status == "completed" and a.independent_reward == 1)
                for a in self.attempts
            ):
                raise ValueError(
                    "Final success must follow official goal and Runtime completion"
                )
        elif self.scoring_adjustments:
            raise ValueError("Only final judgments can adjust episode scores")
        if self.official_metrics is not None:
            if self.config.benchmark != "appworld":
                raise ValueError("Scene metrics require AppWorld")
            groups = {}
            for task in self.task_ids:
                family, _, variant = task.rpartition("_")
                groups.setdefault(family, set()).add(variant)
            if any(variants != {"1", "2", "3"} for variants in groups.values()):
                raise ValueError("Official scene metrics need complete scenarios")
            if {m.trial for m in self.official_metrics} != set(
                range(self.trials)
            ) or len(self.official_metrics) != self.trials:
                raise ValueError("Official regrade must cover every trial")
            for metric in self.official_metrics:
                rows = [a for a in self.attempts if a.trial == metric.trial]
                if len(rows) != len(self.task_ids) or any(
                    a.independent_reward is None and a.official_reward is None
                    for a in rows
                ):
                    raise ValueError("Official metrics need all planned scores")
                rewards = {
                    a.task_id: (
                        a.independent_reward
                        if a.independent_reward is not None
                        else a.official_reward
                    )
                    == 1
                    for a in rows
                }
                tgc = round(sum(rewards.values()) / len(rewards) * 100, 1) / 100
                sgc = (
                    round(
                        sum(
                            all(rewards[f"{f}_{v}"] for v in ("1", "2", "3"))
                            for f in groups
                        )
                        / len(groups)
                        * 100,
                        1,
                    )
                    / 100
                )
                if (
                    metric.tasks != len(self.task_ids)
                    or metric.scenarios != len(groups)
                    or abs(metric.task_goal_completion - tgc) > 1e-9
                    or abs(metric.scenario_goal_completion - sgc) > 1e-9
                ):
                    raise ValueError("Official regrade disagrees with recorded rewards")
        return self


class Report(PublicModel):
    schema_version: Literal[1, 2, 3]
    exported_at: datetime
    runs: list[Run] = Field(max_length=1000)

    @model_validator(mode="after")
    def unique_runs(self):
        if self.schema_version < 3 and any(r.component is not None for r in self.runs):
            raise ValueError("Component results require schema version 3")
        if len({r.run_id for r in self.runs}) != len(self.runs):
            raise ValueError("Duplicate runs")
        return self


def export_run(root: Path) -> Run:
    if (root / "publication-hold.json").exists() or (root.parent / "publication-hold.json").exists():
        raise ValueError("Evaluation batch is held for operator review")
    manifest = json.loads((root / "manifest.json").read_text())
    # Config is explicitly projected, never forwarded wholesale.
    config = Config.model_validate(
        {
            k: manifest["config"][k]
            for k in Config.model_fields
            if k in manifest["config"]
        }
    )
    component = ComponentProtocol.model_validate(manifest["component"]) if manifest.get("component") else None
    attempts, scopes, revisions, profiles = [], set(), set(), set()
    for path in sorted(root.iterdir()):
        if not re.fullmatch(r"attempt_\d+\.json", path.name):
            continue  # In particular, never open attempt_*.trace.json.
        record = json.loads(path.read_text())
        record_config = Config.model_validate(
            {
                k: record["config"][k]
                for k in Config.model_fields
                if k in record["config"]
            }
        )
        expected_config = config
        if component is not None:
            if record.get("run_scope") != "controlled-batch" or record.get("condition") != component.condition:
                raise ValueError("Canary or mismatched condition cannot be published")
            if record.get("judge") != component.judge_model:
                raise ValueError("Judge model differs from declared protocol")
            expected_config = config.model_copy(update={"timeout_seconds": component.task_timeouts[record["task_id"]]})
        if record_config != expected_config:
            raise ValueError("Mixed configurations")
        if record.get("schema_version", 1) != 1:
            raise ValueError("Unsupported attempt schema")
        scopes.add(record["validation_scope"])
        if record.get("profile"):
            profiles.add(record["profile"])
        if record.get("upstream_revision"):
            revisions.add(record["upstream_revision"])
        attempts.append(
            Attempt.model_validate(
                {
                    k: record.get(
                        k, False if k == "dataset_revision_verified" else None
                    )
                    for k in Attempt.model_fields
                }
            )
        )
    if len(scopes) != 1 or len(revisions) > 1 or len(profiles) > 1:
        raise ValueError("Missing or mixed run provenance")
    official = None
    scoring_basis = "episode"
    scoring_adjustments = 0
    verifier_revision = None
    if (root / "official-metrics.json").exists():
        receipt = json.loads((root / "official-metrics.json").read_text())
        if receipt.get("verified") is not True:
            raise ValueError("Official regrade not verified")
        official = [OfficialTrial.model_validate(row) for row in receipt["trials"]]
        if "regraded_rewards" in receipt:
            grades = {}
            for row in receipt["regraded_rewards"]:
                if (
                    set(row) != {"task_id", "trial", "reward"}
                    or type(row["reward"]) not in {int, float}
                    or row["reward"] not in (0, 1)
                    or type(row["trial"]) is not int
                ):
                    raise ValueError("Invalid independent reward")
                key = (row["task_id"], row["trial"])
                if key in grades:
                    raise ValueError("Duplicate independent reward")
                grades[key] = row["reward"]
            if set(grades) != {(a.task_id, a.trial) for a in attempts}:
                raise ValueError("Independent grading coverage mismatch")
            final_basis = (
                receipt.get("verification_basis") == "two-post-close-official-graders"
            )
            if final_basis:
                scoring_basis = "post-close-official"
                verifier_revision = receipt["verifier_revision"]
                scoring_adjustments = receipt["episode_success_adjustments"]
            attempts = [
                a.model_copy(
                    update={
                        "independent_reward": grades[(a.task_id, a.trial)],
                        "episode_success": a.success
                        if final_basis
                        else a.episode_success,
                        "success": (
                            a.status == "completed"
                            and grades[(a.task_id, a.trial)] == 1
                        )
                        if final_basis
                        else a.success,
                    }
                )
                for a in attempts
            ]
    return Run(
        scoring_basis=scoring_basis,
        scoring_adjustments=scoring_adjustments,
        verifier_revision=verifier_revision,
        protocol=manifest.get("protocol"),
        component=component,
        official_metrics=official,
        run_id=root.name,
        scope="development",
        validation_scope=scopes.pop(),
        model_snapshot_verified=False,
        config=config,
        harness_profile=next(iter(profiles), "unrecorded"),
        upstream_revision=next(iter(revisions), None),
        task_ids=manifest["task_ids"],
        trials=manifest["trials"],
        attempts=attempts,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = Report(
        schema_version=3,
        exported_at=datetime.now(timezone.utc),
        runs=[export_run(root) for root in args.run],
    )
    # Validate everything before atomic replacement; failed imports preserve last publication.
    target = args.output
    temporary = target.with_name(target.name + ".next")
    temporary.write_text(report.model_dump_json(indent=2) + "\n")
    temporary.chmod(0o644)
    os.replace(temporary, target)
    print(f"Published {len(report.runs)} sanitized runs")


if __name__ == "__main__":
    main()
