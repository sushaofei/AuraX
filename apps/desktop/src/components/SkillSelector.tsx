import { listSkills, toggleSkill, type ClawClient, type SkillSummary } from "@aurax/claw-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorText } from "../lib/errors";

export function SkillSelector({
  client,
  locked,
  compact = false,
}: {
  client: ClawClient;
  locked: boolean;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const skills = useQuery({
    queryKey: ["skills", client.baseUrl],
    queryFn: async () => (await listSkills(client)).body.items ?? [],
  });
  const toggle = useMutation({
    mutationFn: async (skill: SkillSummary) => {
      if (!skill.installation) {
        throw new Error("Skill 尚未安装，请先到 Skill 管理页安装");
      }
      const active = skill.installation.status === "active";
      await toggleSkill(
        client,
        skill.publisher,
        skill.name,
        active ? "disable" : "enable",
        skill.installation.revision,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
  const selectableSkills = (skills.data ?? []).filter(
    (skill) =>
      skill.installation?.status === "active" || skill.installation?.status === "disabled",
  );

  return (
    <div className={`skill-picker ${compact ? "compact" : ""}`}>
      <div className="skill-picker-copy">
        <p className="skill-picker-label">允许使用的 Skill</p>
        <p className="mono">
          {compact
            ? "设置在下一轮 Run 生效"
            : "勾选改的是租户目录，下一轮 Run 由 AuraClaw Resolver 解析；进行中的 Run 不受影响。"}
        </p>
      </div>
      {skills.error ? <p className="error">{errorText(skills.error)}</p> : null}
      <div className="chip-row">
        {selectableSkills.map((skill) => {
          const pressed = skill.availability === "available";
          return (
            <button
              key={`${skill.publisher}/${skill.name}`}
              type="button"
              className="skill-chip"
              aria-pressed={pressed}
              disabled={locked || toggle.isPending || !skill.installation}
              title={skill.description || `${skill.publisher}/${skill.name}`}
              onClick={() => toggle.mutate(skill)}
            >
              {skill.name}
              <span>{pressed ? "开" : "关"}</span>
            </button>
          );
        })}
      </div>
      {selectableSkills.length === 0 ? (
        <p className="empty">当前没有可用于对话的 Skill。到 Skill 页查看目录。</p>
      ) : null}
      {toggle.error ? <p className="error">{errorText(toggle.error)}</p> : null}
    </div>
  );
}
