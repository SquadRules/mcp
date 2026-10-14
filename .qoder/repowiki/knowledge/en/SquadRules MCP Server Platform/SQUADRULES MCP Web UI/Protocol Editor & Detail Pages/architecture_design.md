Two top-level route components plus a sub-folder of editor fragments:
- `ProtocolDetailPage.tsx` is the read-only view: it fetches a protocol via `useProtocol`, parses its markdown into title/steps/triggers/completion, renders a `StepFlowGraph`, lists steps with `ChallengeCard`, and exposes download-as-.md / .zip skill-bundle actions.
- `ProtocolEditPage.tsx` is the authoring surface: it owns the `ProtocolFormState` (label, triggers, steps, completion), drives upload/import, validates against the Zod schema in `protocol-edit/constants.ts`, and dispatches to `/api/train` (new) or `/api/tune` (edit) via `apiFetch`. It composes four child components from `protocol-edit/`:
  - `ProtocolEditSpaceSection` — target/fork space selection
  - `ProtocolEditImportSection` — file upload that reparses markdown into form state
  - `ProtocolEditStepCard` — per-step editor (shell/mcp/user_input/comment variants)
  - `ProtocolEditPreviewColumn` — live rendered preview + generated folder slug
- Shared constants (`markdownSchema`, `DEFAULT_STEP`, `CHALLENGE_TYPE_KEYS`, `SOURCE_ADAPTER_URI_RE`) live in `protocol-edit/constants.ts` and are the single source of truth for validation and default shapes. All data loading goes through `@/hooks/useProtocol`; UI state never touches the network directly except the two `apiFetch` calls in the submit handler.