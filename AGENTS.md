# AGENTS.md

AuraX is the macOS workspace for AuraClaw. Product tracking:
https://github.com/sushaofei/AuraX/issues/1

## Commands

```bash
pnpm install
pnpm --filter @aurax/claw-sdk test
pnpm --filter @aurax/desktop typecheck
pnpm lint
pnpm --filter @aurax/desktop e2e
pnpm --filter @aurax/desktop dev
```

## Rules

- TypeScript strict. No `any` unless bridging a documented JSON bag.
- UI never calls `fetch` / EventSource directly. Use `@aurax/claw-sdk`.
- Do not connect to AuraMCP or `/internal/v1/*`.
- v1 identity is `MOCK_IDENTITY` (`platform` / `local-org` / `local-user`). Do not add an account switcher.
- Do not add a local timer, cron, or menu-bar scheduler.
- Secrets are `credential_ref` only. Never persist plaintext tokens.
- Closing a window must not cancel the AuraClaw task.
