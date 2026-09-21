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

Per-role options: `key`, `label`, `discordRoleId` (all required), plus optional
`emoji` and `description` (the description shows in dropdown mode only).

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

## Development

```bash
npm test         # unit tests (node:test)
npm run typecheck
npm run build
```
