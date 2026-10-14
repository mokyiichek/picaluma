@AGENTS.md

## Claude Code notes

- Rules in `.claude/rules/` apply to every change.
- Before claiming a UI change works, run `npx tsc --noEmit`, `npx vite build` and
  `cargo build --manifest-path src-tauri/Cargo.toml`, then launch `npx tauri dev`.
- When matching Picasa behaviour, consult `docs/PICASA_SPEC.md` first.
