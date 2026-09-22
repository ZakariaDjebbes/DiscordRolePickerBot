# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm test                  # all unit tests (node:test via tsx)
npm run typecheck         # tsc --noEmit
npm run build             # tsc -> dist/
npm run dev               # tsx watch src/index.ts
npm start                 # node dist/index.js (requires build)
npm run deploy-commands   # register /rolepicker in the configured guild
```

Docker (see README for the full deployment notes):

```bash
docker compose up -d --build
docker compose run --rm bot node dist/scripts/deploy-commands.js
```

In the runtime image `npm run deploy-commands` does **not** work — it runs
through `tsx`, a devDependency pruned by `npm ci --omit=dev`. Use the compiled
`dist/scripts/deploy-commands.js` instead.

Run a single test file, or filter by name:

```bash
node --import tsx --test src/core/selection.test.ts
node --import tsx --test --test-name-pattern="exclusive" src/core/selection.test.ts
```

`npm test` and `npm run typecheck` need no Discord credentials. Anything that
starts the bot needs `.env` (copy `.env.example`) and `config/roles.json` (copy
`config/roles.example.json`).

Validate a config change without a Discord connection by loading it through
`validateConfig` — the example config is exercised this way in
`src/config/load.test.ts`.

## Architecture

A Discord bot for a WoW guild. Members self-assign roles by clicking buttons or
choosing from a dropdown on persistent messages. **Roles are data, not code:**
adding a role or a whole group is an edit to `config/roles.json` plus
`/rolepicker setup`. Resist any change that requires touching a handler to add a
role.

### The selection cap is the core abstraction

A group's `mode` is sugar over a single number — the maximum roles a member may
hold in that group:

- `exclusive` → cap of 1
- `multi` → cap of `roles.length`
- `maxSelections` → overrides both

`resolveMaxSelections()` in `src/config/types.ts` is the only place this is
decided, and `src/core/selection.ts` is the only place the cap is enforced. A
new selection behaviour belongs in those two files as a cap variation, **not**
as a new branch in `src/bot/interactions.ts`. That is why "pick up to two specs"
needed no new code.

### `src/core/selection.ts` must stay pure

It imports no discord.js. It takes a group, the role IDs a member currently
holds, and what they clicked; it returns `{ add, remove, rejection? }`. This is
what makes every group rule testable without a Discord connection, and
`selection.test.ts` is the main safety net in the repo. Keep Discord types out
of it — resolve them in `src/bot/` and pass plain IDs in.

Two intents, deliberately different:

- `planButtonClick` — **toggle** intent. Held → remove. Not held with room →
  add. Not held and full: a cap of 1 swaps (Horde can only mean *not*
  Alliance), a cap of 2+ **refuses**, because which of the others to evict would
  be a guess.
- `planMenuSubmit` — **replace** intent. The chosen set becomes the member's
  set, diffed against what they hold.

### Config is validated, then resolved

Two distinct stages, and the difference matters:

```
config/roles.json
  -> src/config/load.ts        validate SHAPE once at startup (no Discord)
  -> src/bot/roleResolver.ts   resolve each role to a real Discord role ID
  -> src/bot/registry.ts       holds the ResolvedConfig every handler reads
  -> src/ui/render.ts          one message per group, buttons or dropdown
  -> src/ui/customId.ts        rolepicker:btn:<group>:<role> | rolepicker:menu:<group>
  -> src/bot/interactions.ts   route to the group, apply, reply ephemerally
     src/core/selection.ts     <- the rules live here
```

`discordRoleId` is **optional** in the config, so a validated `RolePickerConfig`
may still name roles that do not exist in Discord. `ResolvedConfig` (every role
carrying a real ID) is what the rest of the bot works with, and the type system
enforces the distinction: `RoleGroup<TRole>` is generic, and `selection.ts`,
`render.ts`, `setup.ts` and `hierarchy.ts` all take `ResolvedGroup`/
`ResolvedConfig`. Do not weaken those signatures back to the unresolved type.

Resolution order per role, first hit wins: explicit `discordRoleId` → an ID the
bot remembered → a guild role whose name equals `label` → a newly created role.
Steps 2-4 record the ID in the state store, so after the first resolution the
link is by ID and renaming the role in Discord no longer breaks it.

**Creating roles only ever happens in `/rolepicker setup`** (`create: true`).
Startup and `/rolepicker check` resolve with `create: false` and merely report
what is missing — a restart must never mutate the server.

`src/state/store.ts` maps `groupKey -> messageId` so `/rolepicker setup` edits
messages in place instead of posting duplicates, and `groupKey:roleKey -> roleId`
for roles the bot resolved or created. It sits behind a `StateStore` interface
because the likely next step is a database once groups become editable from
Discord rather than from a file.

### Logging

`src/logging/logger.ts` is a hand-rolled file logger — no framework, because
the project keeps two runtime dependencies and the wanted format is specific.
Lines are `timestamp · level · event · actor · message`, written to
`logs/rolepicker.log` with size-based rotation, and mirrored to the console so
`docker logs` still works.

- **Logging never throws.** Writes are fire-and-forget through a serialised
  promise chain, and a failure warns once on the console then gives up. A
  failed log write must never break a member's role change.
- **New events go in the `LogEvent` union**, not inline at the call site — the
  event column is the greppable half of a line.
- **The pure parts are separate** (`formatRecord`, `formatActor`, `shouldLog`)
  so the format is unit-tested, and rotation is tested against a temp directory.
- **Only `src/bot/` and `src/index.ts` log.** `src/core/selection.ts` stays
  pure and takes no logger.
- Remaining `console.*` calls are deliberate: inside the logger itself, in the
  top-level catch in `index.ts` (which runs before a logger exists), and in the
  standalone `deploy-commands` script.

## Invariants

These are load-bearing. Breaking one tends to fail at runtime in someone's
Discord server rather than in CI.

- **Validation happens once, at load.** Runtime code assumes a well-formed
  config — no re-checking for duplicate keys or missing fields in handlers. New
  config fields get validated in `src/config/load.ts` with a path-style error
  message (`groups[1].roles[0].discordRoleId`).
- **Role labels are unique across the whole config.** A role without an explicit
  `discordRoleId` is matched to Discord by name, so two roles sharing a label
  would race for the same Discord role. Enforced in validation.
- **Creating roles is confined to `/rolepicker setup`.** Startup and
  `/rolepicker check` pass `create: false`. Nothing that runs automatically may
  mutate the server.
- **Created roles get `permissions: []` explicitly.** These are organisational
  labels; a role that silently carried permissions would be a security problem.
- **Button colour means role identity, never selection state.** A shared picker
  message renders identically for every viewer and cannot show per-member
  state. Anything that does show state (an ephemeral panel) must mark it another
  way, such as a leading tick — otherwise the two meanings of colour collide.
- **Config keys are capped at 32 characters** so `rolepicker:btn:<group>:<role>`
  stays inside Discord's 100-char `custom_id` limit. Changing the custom_id
  format means rechecking that budget.
- **One Discord role belongs to exactly one group.** Enforced in validation —
  otherwise one group's cap silently undoes another's.
- **One group renders as one message.** Adding a group later posts one new
  message and leaves the others (and everyone's scroll position) alone.
- **Only the `Guilds` intent.** Interaction payloads carry the clicking member
  and their roles, so neither the privileged `GuildMembers` intent nor a member
  cache is needed. Do not add intents to read roles.
- **Role changes go through one `member.roles.set()`**, not add-then-remove, so
  a member never passes through a state the group's own rules forbid.
- **Every member-facing reply is ephemeral**, via `flags: MessageFlags.Ephemeral`
  (discord.js v14 deprecated `ephemeral: true`).
- **`exactOptionalPropertyTypes` is on.** Build optional fields with the
  conditional-spread pattern used in `load.ts` rather than assigning `undefined`.

## Gotchas

- **Role hierarchy is the number one failure mode.** Discord refuses to let a
  bot assign a role positioned at or above its own highest role, and fails with
  a 403 that looks like the bot doing nothing. `src/bot/hierarchy.ts` checks
  this at boot and blocks `/rolepicker setup`; `/rolepicker check` reports it on
  demand. Keep that check ahead of anything that posts a picker.
- **Channel permission overwrites beat the invite link.** A bot with server-wide
  Send Messages can still be locked out of one channel, and posting an embed
  needs `EmbedLinks` on top of `SendMessages`. `checkChannelAccess` covers this;
  `checkSetupReadiness` runs it together with the role checks, and boot, setup
  and check all call that one function. Add new preconditions there so all three
  stay in step.
- **Exclusive groups remove roles the member did not ask to lose.** The
  ephemeral confirmation must name them — `describePlan` does this, and the
  wording is asserted in tests. Do not reduce it to a bare "Done".
- **Never reuse or rename a config `key`.** Keys are baked into the custom_ids
  of already-posted messages; a rename orphans every live button until setup
  runs again.
- **Setup does not delete anything.** Groups dropped from the config are
  reported as orphaned; removing the message is an admin's call.
- **The state file must survive container recreation.** In Docker it lives on
  the `picker-state` named volume. It now holds resolved role IDs as well as
  message IDs, so losing it costs more than it used to: the next
  `/rolepicker setup` posts a second set of picker messages, and roles without
  an explicit `discordRoleId` fall back to matching by name — which creates a
  *duplicate role* if someone renamed it in Discord meanwhile. Still quiet
  rather than loud, which is what makes it worth guarding.
- **Setup never deletes a role.** A role dropped from the config is reported,
  not removed: deleting it would strip it from every member holding it.

## Project state

The repository was created empty, so the initial branch
(`claude/gracious-dijkstra-8j4cls`) is currently GitHub's default branch and no
pull request exists for it. Confirm with the user which branch to base new work
on before assuming `main` exists.
