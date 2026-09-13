# Native resource implementation

The runtime uses authenticated DSH Connection fetch routes on both Web and the Desktop worker carrier. Requests carry the boot profile identity; MCP edit/delete also carries the inventory revision. Files are never resolved against a guessed `web` profile.

Skills use the native filesystem preset and provider registry. Hub rules apply in native preset/Agent scopes. The workspace selector filters the filesystem cwd. Shared source files remain unchanged by enable/disable operations. `skill-file` accepts only an inventory ID and reads that skill's confined SKILL.md.

MCP formatting parses a document without adding defaults, changing its wrapper, resolving environment references or doing network operations. JSON `__jsExpr` objects and YAML `!!js` tags round-trip. Only simple `process.env.NAME` references and string templates around one such reference are supported. Runtime activation resolves references against the host's environment and applies DSH defaults. The help table mirrors dsh-mcp-client's Config and reconnect defaults.

Ordinary inventory responses exclude credentials. Full config is returned only to an explicit edit request. Hub-owned configurations are replaced in Hub state. External overrides preserve the native source until a real delete: only uniquely identified MCP definitions in canonical files inside this profile, excluding node_modules, are eligible. Deletion edits YAML nodes while retaining other rows and comments, then disposes the native loader entry. Shared/package definitions must be deleted at their source.

Descriptions, versions and icons are read from the MCP initialize result during an explicit probe; descriptions are plain text. Connection health remains unknown because the native client does not expose it publicly. A successful probe is a separate, timestamped observation.

The file pane reuses native MarkdownText for the body, omits YAML frontmatter and absolute-path metadata, and titles the preview as `skill-name/skill.md`; the main page, help split and modal sizing are layout adaptations because the native sidebar is session-bound and hides when a custom main panel is active. Controls and fonts use native primitives/tokens. Escape is captured for Hub modals so it does not also dismiss the underlying main panel.

Agent Teams uses its two official profile packages. Web installation delegates to DSH CLI with an explicit current profile and exact host version. Disabling removes only the two feature bundles and retains dependencies for offline reactivation; changes need a restart. Desktop mutations use the app preload's optional `experiments` v1 bridge; package-management APIs remain confined to the native management window. Missing or unsupported bridge versions stay read-only, with an explicit unsupported message.

The repository is a single npm package with source, tests and build/release scripts at its root. Local research, preview profiles and verification artifacts live under the ignored `.local/` directory.

## Desktop experiment bridge v1

The application supplies `window.dshDesktop.experiments = { version: 1, list, setEnabled }`. `list()` returns `{ profile, features }`, where `profile` is the canonical boot profile directory and each known feature has `id`, `enabled`, `activeEnabled` (boolean or null), `installed`, `canToggle` and `busy`. Hub currently consumes `agent-teams`; unknown IDs are not rendered as actionable features. `enabled` is the persisted choice, while `activeEnabled` is the host's running-state observation. Web reports its boot choice until a restart; Desktop reports unknown while its backend is stopped.

`setEnabled({ profile, id, enabled, expectedEnabled })` rejects a different profile or changed choice. The host validates the main application frame, allowlists feature IDs, shares its package-transaction lock, refuses shutdown during active work and retains ownership of staging, rollback and recovery. It returns `{ ok: true, value: snapshot, reloadRequired }` only after recovery, or `{ ok: false, error: { code, message? } }`. Codes are `invalid-request`, `profile-changed`, `unsupported`, `busy`, `state-changed`, `tasks-running` and `failed`; Hub owns their Chinese/English presentation. Hub reloads after a successful acknowledgement requesting it and refreshes state after refusals. Failed or malformed replies never trigger a Web mutation fallback.

The Desktop fork must ship this bridge and Hub 0.2.1 or later together. Public npm publication and a new Desktop package are separate release steps; source/build verification does not update installed applications.
