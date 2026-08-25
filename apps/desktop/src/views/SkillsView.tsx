import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSkill, listSkills, toggleSkill, type ClawClient, type SkillSummary } from "@aurax/claw-sdk";
import { useState } from "react";
import { MarkdownBody } from "../components/MarkdownBody";
import { errorText } from "../lib/errors";

export function SkillsView({ client }: { client: ClawClient }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<{ publisher: string; name: string } | null>(null);
  const skills = useQuery({
    queryKey: ["skills", client.baseUrl],
    queryFn: async () => (await listSkills(client)).body.skills,
  });
  const detail = useQuery({
    queryKey: ["skill", client.baseUrl, selected],
    queryFn: async () => (await getSkill(client, selected!.publisher, selected!.name)).body,
    enabled: Boolean(selected),
  });
  const toggle = useMutation({
    mutationFn: async (input: { skill: SkillSummary; action: "enable" | "disable" }) => {
      await toggleSkill(client, input.skill.publisher, input.skill.name, input.action);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
      void queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
  return (
    <section>
      <p className="kicker">Catalog</p>
      <h1>Skill</h1>
      <p className="lede">只读目录与租户启停。没有发布入口，也不会在本机执行 Skill。对话页可勾选允许使用的 Skill。</p>
      {skills.error ? <p className="error">{errorText(skills.error)}</p> : null}
      <div className="list">
        {(skills.data ?? []).map((skill) => (
          <div key={`${skill.publisher}/${skill.name}`} className="card">
            <div className="row">
              <button className="btn ghost" type="button" onClick={() => setSelected(skill)}>
                {skill.publisher}/{skill.name}
              </button>
              <span className={`pill ${skill.status === "active" ? "ok" : "off"}`}>
                {skill.status}
              </span>
              <button
                className="btn ghost"
                type="button"
                disabled={toggle.isPending}
                onClick={() =>
                  toggle.mutate({
                    skill,
                    action: skill.status === "active" ? "disable" : "enable",
                  })
                }
              >
                {skill.status === "active" ? "停用" : "启用"}
              </button>
            </div>
            <p>{skill.description}</p>
          </div>
        ))}
      </div>
      {skills.data?.length === 0 ? <p className="empty">还没有可见 Skill。</p> : null}
      {detail.data ? (
        <article className="card" style={{ marginTop: 16 }}>
          <h2>
            {detail.data.publisher}/{detail.data.name}@{detail.data.version}
          </h2>
          {detail.data.skill_markdown ? (
            <MarkdownBody text={detail.data.skill_markdown} />
          ) : (
            <p className="empty">没有 SKILL.md</p>
          )}
        </article>
      ) : null}
    </section>
  );
}
