import { listSkills, toggleSkill, type ClawClient, type SkillSummary } from "@aurax/claw-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorText } from "../lib/errors";

export function SkillSelector({ client, locked }: { client: ClawClient; locked: boolean }) {
  const queryClient = useQueryClient();
  const skills = useQuery({
    queryKey: ["skills", client.baseUrl],
    queryFn: async () => (await listSkills(client)).body.skills,
  });
  const toggle = useMutation({
    mutationFn: async (skill: SkillSummary) => {
      await toggleSkill(
        client,
        skill.publisher,
        skill.name,
        skill.status === "active" ? "disable" : "enable",
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  return (
    <div className="skill-picker">
      <p className="skill-picker-label">允许使用的 Skill</p>
      <p className="mono">
        勾选改的是租户目录，下一轮 Run 由 AuraClaw Resolver 解析；进行中的 Run 不受影响。
      </p>
      {skills.error ? <p className="error">{errorText(skills.error)}</p> : null}
      <div className="chip-row">
        {(skills.data ?? []).map((skill) => {
          const pressed = skill.status === "active";
          return (
            <button
              key={`${skill.publisher}/${skill.name}`}
              type="button"
              className="skill-chip"
              aria-pressed={pressed}
              disabled={locked || toggle.isPending}
              title={skill.description || `${skill.publisher}/${skill.name}`}
              onClick={() => toggle.mutate(skill)}
            >
              {skill.name}
              <span>{pressed ? "开" : "关"}</span>
            </button>
          );
        })}
      </div>
      {skills.data?.length === 0 ? (
        <p className="empty">租户还没有 Skill。到 Skill 页查看目录。</p>
      ) : null}
      {toggle.error ? <p className="error">{errorText(toggle.error)}</p> : null}
    </div>
  );
}
