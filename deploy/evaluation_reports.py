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
    status: Literal["completed", "incomplete", "budget_exhausted", "infra_error", "runtime_error", "evaluation_error", "timeout"]
    success: bool = Field(strict=True)
    official_reward: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)] | None
    elapsed_seconds: Number | None
    model_calls: Count | None
    tool_calls: Count | None
    dataset_revision_verified: bool = Field(strict=True)

    @model_validator(mode="after")
    def consistent_success(self):
        if self.success and (self.status != "completed" or self.official_reward != 1):
            raise ValueError("Inconsistent successful attempt")
        return self


class Run(PublicModel):
    run_id: Annotated[str, Field(pattern=r"^eval_[a-f0-9]{32}$")]
    scope: Literal["development"]
    validation_scope: Literal["official-sdk-adapter", "fixture"]
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
            if a.task_id not in self.task_ids or a.trial >= self.trials or key in identities:
                raise ValueError("Unexpected or duplicate attempt")
            identities.add(key)
        return self


class Report(PublicModel):
    schema_version: Literal[1]
    exported_at: datetime
    runs: list[Run] = Field(max_length=1000)

    @model_validator(mode="after")
    def unique_runs(self):
        if len({r.run_id for r in self.runs}) != len(self.runs):
            raise ValueError("Duplicate runs")
        return self


def export_run(root: Path) -> Run:
    manifest = json.loads((root / "manifest.json").read_text())
    # Config is explicitly projected, never forwarded wholesale.
    config = Config.model_validate({k: manifest["config"][k] for k in Config.model_fields if k in manifest["config"]})
    attempts, scopes, revisions, profiles = [], set(), set(), set()
    for path in sorted(root.iterdir()):
        if not re.fullmatch(r"attempt_\d+\.json", path.name):
            continue  # In particular, never open attempt_*.trace.json.
        record = json.loads(path.read_text())
        record_config = Config.model_validate({k: record["config"][k] for k in Config.model_fields if k in record["config"]})
        if record_config != config:
            raise ValueError("Mixed configurations")
        if record.get("schema_version", 1) != 1:
            raise ValueError("Unsupported attempt schema")
        scopes.add(record["validation_scope"])
        if record.get("profile"):
            profiles.add(record["profile"])
        if record.get("upstream_revision"):
            revisions.add(record["upstream_revision"])
        attempts.append(Attempt.model_validate({
            k: record.get(k, False if k == "dataset_revision_verified" else None)
            for k in Attempt.model_fields
        }))
    if len(scopes) != 1 or len(revisions) > 1 or len(profiles) > 1:
        raise ValueError("Missing or mixed run provenance")
    return Run(run_id=root.name, scope="development", validation_scope=scopes.pop(),
               model_snapshot_verified=False, config=config,
               harness_profile=next(iter(profiles), "unrecorded"),
               upstream_revision=next(iter(revisions), None), task_ids=manifest["task_ids"],
               trials=manifest["trials"], attempts=attempts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = Report(schema_version=1, exported_at=datetime.now(timezone.utc),
                    runs=[export_run(root) for root in args.run])
    # Validate everything before atomic replacement; failed imports preserve last publication.
    target = args.output
    temporary = target.with_name(target.name + ".next")
    temporary.write_text(report.model_dump_json(indent=2) + "\n")
    temporary.chmod(0o644)
    os.replace(temporary, target)
    print(f"Published {len(report.runs)} sanitized runs")


if __name__ == "__main__":
    main()
