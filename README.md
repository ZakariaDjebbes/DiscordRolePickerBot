# Discord Role Picker Bot

Self-service role selection for a WoW guild's Discord. Members click a button (or
pick from a dropdown) and the bot grants or removes the matching Discord role.

Roles are organised into **groups**, and each group decides how many of its roles
a member may hold at once:

| Group | Mode | Behaviour |
| --- | --- | --- |
| Combat Role | `multi` | Tank + Healer + DPS all at once — hybrids are normal |
| Languages | `multi` | Pick every language you speak |
| Faction | `exclusive` | Alliance **or** Horde, picking one clears the other |
| Main Specs | `multi`, `maxSelections: 2` | Pick up to two |

Adding a role — or a whole new group — is a config edit and one slash command.
No code change.

## Quick start

```bash
npm install
cp .env.example .env              # fill in token, client ID, guild ID
cp config/roles.example.json config/roles.json   # fill in your channel and role IDs
npm run deploy-commands           # register /rolepicker in your guild
npm run dev                       # or: npm run build && npm start
```

Then, in Discord, run `/rolepicker setup`. The bot posts one message per group
in the configured channel.

### Discord setup

1. Create an application and bot at <https://discord.com/developers/applications>.
2. Under **Bot**, copy the token into `.env`. No privileged intents are needed —
   the bot only uses the `Guilds` intent.
3. Invite it with the `bot` and `applications.commands` scopes and the
   **Manage Roles** permission.
4. **Move the bot's role above every role it manages** in Server Settings →
   Roles. Discord refuses to let a bot assign a role at or above its own
   position, and this is the single most common reason a role picker appears to
   do nothing. `/rolepicker check` verifies this for every configured role.
5. **Check the picker channel's own permissions.** Right-click the channel →
   Edit Channel → Permissions, and make sure the bot has **View Channel**,
   **Send Messages** and **Embed Links** there. Channel overwrites override what
   the invite link granted, and the picker posts embeds — so `Embed Links` is
   required even though ordinary messages would go through without it.
   `/rolepicker check` verifies this too.

## Configuration

`config/roles.json` — see `config/roles.example.json` for a full example.

```jsonc
{
  "channelId": "123...",          // where picker messages are posted
  "groups": [
    {
      "key": "combat-role",       // stable ID; never reuse one
      "label": "Combat Role",     // embed title
      "description": "What you play in raids.",
      "mode": "multi",            // "multi" | "exclusive"
      "roles": [
        { "key": "tank", "label": "Tank", "emoji": "🛡️", "discordRoleId": "123..." }
      ]
    }
  ]
}
```

Per-group options:

| Field | Default | Meaning |
| --- | --- | --- |
| `mode` | required | `multi` = hold every role in the group; `exclusive` = hold exactly one |
| `maxSelections` | from `mode` | Overrides the cap. `mode: "multi"` with `maxSelections: 2` means "pick up to two" |
| `required` | `false` | A member may not drop their last pick in this group |
| `display` | `auto` | `buttons`, `dropdown`, or `auto` (dropdown above 8 roles) |
| `color` | blurple | Hex colour for the embed's accent bar, e.g. `"#C69B6D"` |
| `thumbnail` | none | Image URL shown in the embed corner |
| `footer` | "Only you can see your changes." | Replaces the default footer |

Per-role options: `key` and `label` are required; everything else is optional.

| Field | Meaning |
| --- | --- |
| `discordRoleId` | The Discord role to grant. **Leave it out and the bot creates the role** — see below |
| `emoji` | Unicode emoji, or a custom one as `<:name:id>` |
| `description` | Shown under the label in dropdowns, and listed in the embed body for buttons |
| `style` | Button colour: `primary` (blurple), `secondary` (grey, default), `success` (green), `danger` (red) |
| `color` | Hex colour applied to the Discord role **when the bot creates it** |
| `hoist` | Whether a created role is shown as its own group in the member list |

Button colour means *which role this is*, never "you have this one". A shared
picker message renders identically for every viewer, so it cannot show
per-member state — use `/rolepicker mine`, or the state line in the
confirmation, for that.

### Letting the bot create the roles

Omit `discordRoleId` and `/rolepicker setup` will resolve the role for you:

1. an ID the bot remembered from a previous run, then
2. an existing role whose name matches `label`, then
3. a newly created role — with no permissions, and the `color`/`hoist` you set.

The ID is recorded in the state file, so after the first setup the link is by ID
and renaming the role in Discord no longer matters. Created roles land *below*
the bot's own role, which means they satisfy the hierarchy requirement
automatically.

Roles are **never deleted**. Dropping one from the config leaves it in Discord,
because deleting would strip it from every member holding it.

⚠️ Because unlinked roles are matched by name, **role labels must be unique
across the whole config**. The validator enforces this.

⚠️ Creating roles happens **only** during `/rolepicker setup`. Restarting the
bot, or running `/rolepicker check`, only reports what is missing — neither ever
changes your server.

The config is validated on startup, with errors reported against a path like
`groups[1].roles[0].discordRoleId`. It refuses the mistakes that are painful to
debug live: duplicate keys, the same Discord role in two groups, groups too
large for Discord to draw, and `exclusive` combined with a `maxSelections` above 1.

## How selection behaves

A **button** click carries toggle intent:

- Role already held → removed (unless the group is `required` and it is the last one).
- Not held, room to spare → added.
- Not held, group full:
  - cap of 1 → the held role is swapped out, since "Horde" can only mean "not Alliance".
  - cap of 2+ → refused, with a message asking the member to remove one first.
    Which of the others to evict would be a guess.

A **dropdown** submission carries replace intent: the chosen set becomes the
member's set, and the bot diffs against what they already hold.

Every response is ephemeral — only the clicking member sees it. Because an
exclusive group can remove a role the member never asked to lose, the
confirmation names it: *"Set your **Faction** to **Horde** (removed
**Alliance**)."*

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/rolepicker setup` | Manage Roles | Posts or refreshes the picker messages |
| `/rolepicker check` | Manage Roles | Verifies the bot can assign every configured role |
| `/rolepicker mine` | Manage Roles | Shows your current picks per group |

`setup` is idempotent — it remembers each group's message ID in
`data/picker-state.json` and edits in place, so re-running it after a config
change does not litter the channel. If a group is removed from the config, its
message is reported as orphaned rather than deleted; removing it is an admin's
call.

## Layout

```
src/
  core/selection.ts      Pure group rules — no discord.js, fully unit-tested
  config/                Types, JSON loading, validation
  ui/                    custom_id protocol, button/dropdown rendering
  bot/                   Interaction routing, slash commands, hierarchy checks
  state/                 Where posted message IDs are remembered
```

`src/core/selection.ts` is the only place `multi` and `exclusive` differ, and it
takes plain role IDs in and returns `{ add, remove }` out. The rules are tested
without a Discord connection.

The state store sits behind an interface, so moving group configuration from a
file into a database — and editing it from Discord instead of a redeploy — does
not touch the core.

## Logs

Everything the bot does is written to `logs/rolepicker.log`, one line per event:

```
2026-09-22 14:03:12.482  INFO   selection.applied   member:zakaria(240814000000000000)      Combat Role: +Healer → Tank, Healer
2026-09-22 14:03:20.001  WARN   selection.rejected  member:Mgrix(991200000000000000)        Combat Role: allows at most 2 picks
2026-09-22 14:05:02.115  INFO   role.created        admin:zakaria(240814000000000000)       Created "Français" (1551…) for languages/fr
2026-09-22 14:05:02.500  ERROR  permission.denied   admin:zakaria(240814000000000000)       Cannot post in channel 1551…
```

`timestamp · level · event · actor · message`. The **event** column is a stable
key, so it stays greppable while the message stays readable:

```bash
tail -f logs/rolepicker.log                      # follow live
grep selection.applied logs/rolepicker.log       # every role change
grep -E "ERROR|WARN"   logs/rolepicker.log       # everything that went wrong
grep "240814000000000000" logs/rolepicker.log    # one member's history
```

Events: `selection.applied`, `selection.rejected`, `selection.noop` (debug
only), `command.invoked`, `role.created`, `role.matched`, `role.unresolved`,
`setup.completed`, `setup.failed`, `setup.blocked`, `permission.denied`,
`bot.starting`, `bot.ready`, `bot.guild_missing`, `config.loaded`,
`error.unhandled`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. `debug` also records clicks that changed nothing |
| `LOG_FILE` | `./logs/rolepicker.log` | Empty value logs to the console only |
| `LOG_MAX_SIZE_MB` | `5` | Rotate once the file passes this size |
| `LOG_MAX_FILES` | `5` | Rotated files kept as `.1` … `.5`, oldest dropped |
| `TZ` | UTC in containers | Timestamps follow it — set e.g. `Europe/Paris` for local time |

Entries also go to stdout, so `docker compose logs -f` keeps working.

⚠️ **The log file records Discord usernames and IDs.** `logs/` is gitignored for
that reason. If members ask what is kept about them, this is the file.

Logging never throws: if the file cannot be written, the bot warns once on the
console and carries on. A failed log write can never break a role change.

## Running with Docker

The bot only makes outbound connections to Discord's gateway, so there is no
port to publish and nothing to put behind a reverse proxy.

```bash
cp .env.example .env                              # token, client ID, guild ID
cp config/roles.example.json config/roles.json    # must exist before first up
docker compose up -d --build
docker compose logs -f
```

Register the slash commands once. Inside the image this is the compiled script,
not `npm run deploy-commands` — that runs through `tsx`, which is a
devDependency and is not present in the runtime image:

```bash
docker compose run --rm bot node dist/scripts/deploy-commands.js
```

After a config change, restart and re-run setup in Discord:

```bash
docker compose restart
```

### What persists

| Path | Mount | Why |
| --- | --- | --- |
| `config/roles.json` | bind, read-only | Read at startup; edit it on the host |
| `/app/data` | named volume `picker-state` | Written at runtime |
| `/app/logs` | bind to `./logs` | So `tail -f logs/rolepicker.log` works on the host |

The `logs/` directory is committed (as an empty `.gitkeep`) so Docker does not
create the bind-mount source as root, which would lock out the container's
unprivileged user. If logging stops with a permissions warning, check that
`logs/` is writable by UID 1000.

⚠️ **The `picker-state` volume must survive container recreation.** It maps each
group to the message holding its picker. Lose it and the next
`/rolepicker setup` posts a *second* set of picker messages instead of editing
the existing ones — both sets keep working, so the channel quietly fills with
duplicates. `docker compose down` keeps the volume; `docker compose down -v`
deletes it.

⚠️ **Create `config/roles.json` before the first `up`.** Docker creates a
*directory* at a bind-mount source that does not exist, and the bot then fails
with a confusing read error.

The image runs as the unprivileged `node` user, and `/app/data` is created with
that ownership so the named volume inherits it. If you swap the volume for a
bind mount, make sure the host directory is writable by UID 1000.

There is deliberately **no healthcheck**: there is no endpoint to probe, and a
gateway bot can be silently disconnected while the process still looks alive.
discord.js reconnects on its own, and `restart: unless-stopped` covers crashes.

## Development

```bash
npm test         # unit tests (node:test)
npm run typecheck
npm run build
```
