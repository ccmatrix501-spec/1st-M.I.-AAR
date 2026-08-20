# 1st Mobile Infantry Onboarding Bot — Personal Test Server

Locked to Discord server `1352675653798989947`.

This is the test onboarding flow, modified so it can run in your personal test server without extra client-ID setup.

## What changed for this server

- Guild ID is pre-filled as `1352675653798989947` in `.env.example` and `config.json`.
- Slash commands register to that guild only after login. `CLIENT_ID` is no longer required.
- The public `/onboarding-panel` stays on Step 1. Each recruit’s flow continues in an ephemeral message so testers do not overwrite each other.
- The bot refuses interactions from any other guild.
- If the bot is not in the test server, the console prints an invite URL.
- `config.json` is included so the bot can start after you add a token. Empty role IDs are ignored.

## Current flow

Copy and step titles now follow the mockup. Discord still uses native buttons under the embed, not clickable rows inside an image.

### Step 1 — What are you here for?
- Starship Troopers
- Hell Let Loose: Vietnam
- Ambassador
- Returning Member

### Step 2 — Region
- America / Europe / Asia / Africa / Oceania

### Step 3
**Starship Troopers / Hell Let Loose: Vietnam** — PC / Xbox / PlayStation

**Ambassador / Returning Member** — Rules & Conduct, then I Agree / I Do Not Agree

### Step 4
**Games** — New Recruit / Some Experience / Veteran / Expert

**Ambassador** — community / unit name (modal)

**Returning Member** — previous 1st M.I. name (modal), then previous rank

## Setup

1. Install Node.js 20 or newer.
2. Create a Discord application/bot in the Discord Developer Portal.
3. Enable **Server Members Intent**.
4. Invite the bot to server `1352675653798989947` with:
   - View Channels
   - Send Messages
   - Embed Links
   - Attach Files
   - Read Message History
   - Manage Roles
   - Use Application Commands
5. Put the bot’s role above any roles it should assign.
6. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`.
7. Optional: put role IDs into `config.json`.
8. In this folder:

```bash
npm install
npm start
```

On Windows you can also double-click `start-windows.bat`.

9. In the test server run:

```text
/onboarding-panel
```

## Notes

- Empty role IDs are safely ignored, so you can test the UI before creating roles.
- The bot removes the previous role in the same category before assigning a new one.
- Onboarding state is kept in memory. Restarting the bot resets active test sessions.
- Button presses only affect the person who pressed them.

## Railway deploy

The crash `Cannot find module '/app/index.js'` happens when Railway starts `node index.js` from the wrong folder, or the zip has an extra nested folder.

Use the railway zip in this package: files must sit at the **repo/service root**, not inside `1st-mi-onboarding-bot/`.

1. In Railway, create a new service from the GitHub repo or upload this folder.
2. If the repo has this bot in a subfolder, set **Root Directory** to that folder.
3. Set start command to:

```text
node index.js
```

4. Add these variables:

```text
DISCORD_TOKEN=your_bot_token
GUILD_ID=1352675653798989947
```

5. Enable **Server Members Intent** on the Discord application.
6. Redeploy. The logs should show `Logged in as ...` then `Registered slash commands for guild 1352675653798989947`.

This is a Discord worker, not a website. You do not need a public HTTP port.
