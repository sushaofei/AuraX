import { useQuery } from "@tanstack/react-query";
import { getApprovalModes, type ApprovalMode, type ClawClient, type InteractionMode } from "@aurax/claw-sdk";
import { useEffect, useRef, useState } from "react";
import "./ApprovalModeSelector.css";

const MODES: { value: ApprovalMode; label: string; description: string; icon: string }[] = [
  { value: "request_approval", label: "请求批准", description: "需要审批的操作执行前，先征求你的批准", icon: "✋" },
  { value: "auto_review", label: "帮我批准", description: "自动审核，无法确认安全时询问你", icon: "◇" },
  { value: "full_access", label: "完全访问权限", description: "需要审批的操作无需你逐次确认", icon: "⚑" },
];

export function useApprovalMode(client: ClawClient, sessionId: string | null, interaction: InteractionMode) {
  const scope = JSON.stringify([client.baseUrl, client.identity, sessionId, interaction]);
  const [selection, setSelection] = useState<{ scope: string; mode: ApprovalMode } | null>(null);
  const capabilities = useQuery({
    queryKey: ["approval-modes", client.baseUrl, client.identity],
    queryFn: async () => (await getApprovalModes(client)).body,
    retry: false,
    staleTime: 60_000,
  });
  const supported = capabilities.data?.version === 1 && MODES.every(
    (mode) => capabilities.data?.modes.includes(mode.value),
  );
  const selected = selection?.scope === scope ? selection.mode : undefined;
  return {
    supported,
    loading: capabilities.isPending,
    selected,
    defaultMode: interaction === "streaming" ? "request_approval" as const : "full_access" as const,
    choose: (mode: ApprovalMode) => setSelection({ scope, mode }),
    clear: () => setSelection(null),
    options: supported ? { ...(selected ? { approvalMode: selected } : {}) } : {},
  };
}

export function ApprovalModeSelector({ value, disabled, supported, pending, onChange }: {
  value: ApprovalMode | null;
  disabled: boolean;
  supported: boolean;
  pending?: boolean;
  onChange: (mode: ApprovalMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = MODES.find((mode) => mode.value === value);
  useEffect(() => {
    if (!open) return;
    items.current[Math.max(0, MODES.findIndex((mode) => mode.value === value))]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, value]);
  return <div className="approval-selector" ref={root}>
    <button ref={trigger} type="button" className={`approval-mode-trigger ${value === "full_access" ? "full-access" : ""}`}
      aria-label={`审批模式：${supported ? current?.label ?? "旧版策略" : "当前服务不支持"}`}
      aria-haspopup="menu" aria-expanded={open && !disabled}
      disabled={disabled || !supported} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">{current?.icon ?? "◇"}</span>
      {supported ? current?.label ?? "旧版策略" : "不支持审批模式设置"}
      {pending ? <small>下次发送生效</small> : null}<span aria-hidden="true">⌄</span>
    </button>
    {open && !disabled && supported ? <div className="approval-mode-menu" role="menu" aria-label="如何批准操作"
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
        if (event.key === "Tab") setOpen(false);
        const index = items.current.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowDown" ? 1 : 2)) % 3;
          items.current[next]?.focus();
        }
      }}>
      <div className="approval-mode-heading">如何批准 AuraClaw 的操作？</div>
      {MODES.map((mode, index) => <button key={mode.value} type="button" role="menuitemradio"
        ref={(node) => { items.current[index] = node; }} aria-checked={value === mode.value}
        className={mode.value === "full_access" ? "full-access" : ""}
        onClick={() => { onChange(mode.value); setOpen(false); trigger.current?.focus(); }}>
        <span className="approval-mode-icon" aria-hidden="true">{mode.icon}</span>
        <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
        <span aria-hidden="true">{value === mode.value ? "✓" : ""}</span>
      </button>)}
    </div> : null}
  </div>;
}
