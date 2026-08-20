# 1st Mobile Infantry Onboarding Bot — Personal Test Server

Locked to Discord server `1352675653798989947` by default.

## UI fix in this build

The onboarding mockups originally contained button-looking rows **inside the PNG** and Discord then rendered the real buttons underneath. That made the interface look duplicated and much taller than intended.

This build fixes that by:

- turning the PNGs into clean branded header/content cards;
- using only real Discord controls for selections;
- displaying Step 1 as a **2 × 2** button layout;
- displaying Region in compact rows;
- displaying PC / Xbox / PlayStation on one row;
- displaying experience and returning-rank choices in compact rows;
- keeping Rules / Agree / Decline as real buttons;
- keeping the privacy notice in the Discord embed footer;
- preserving the existing role-assignment and branching logic.

### Custom Starship Troopers / HLL button emblems

Discord buttons cannot use a PNG/JPG/WebP file directly as their icon. The image must first be uploaded to Discord as a **custom server emoji**.

After uploading the two supplied emblems as server emojis, copy each emoji's numeric ID into `config.json`. This build accepts the numeric ID directly:

```json
"emojis": {
  "starship": "YOUR_STARSHIP_EMOJI_ID",
  "hllv": "YOUR_HLL_EMOJI_ID",
  "ambassador": "",
  "returning": "",
  "pc": "",
  "xbox": "",
  "playstation": ""
}
```

If an emoji ID is blank, the bot safely falls back to a normal Unicode icon.

## Current flow

### Step 1 — What are you here for?
- Starship Troopers
- Hell Let Loose: Vietnam
- Ambassador
- Returning Member

Selecting an option can assign the matching `roles.paths` role.

### Step 2 — Region
- America
- Europe
- Asia
- Africa
- Oceania

Selecting an option can assign the matching `roles.regions` role.

### Step 3

**Starship Troopers / Hell Let Loose: Vietnam**
- PC
- Xbox
- PlayStation

The bot can assign the matching `roles.platforms` role.

**Ambassador / Returning Member**
- Rules & Conduct
- I Agree / I Do Not Agree

### Step 4

**Starship Troopers / Hell Let Loose: Vietnam**
- New Recruit
- Some Experience
- Veteran
- Expert

**Ambassador**
- Community / unit name modal

**Returning Member**
- Previous 1st M.I. name modal
- Previous rank / role

## Setup

1. Install Node.js 20 or newer.
2. Create a Discord application/bot in the Discord Developer Portal.
3. Enable **Server Members Intent**.
4. Invite the bot with:
   - View Channels
   - Send Messages
   - Embed Links
   - Attach Files
   - Read Message History
   - Manage Roles
   - Use Application Commands
5. Put the bot's Discord role above any roles it should assign.
6. Create a `.env` file and set:

```text
DISCORD_TOKEN=your_bot_token
```

7. Put your role IDs into `config.json`.
8. Optional: upload your custom emblems as Discord server emojis and put their IDs in `config.json`.
9. Run:

```bash
npm install
npm start
```

10. In the server, run:

```text
/onboarding-panel
```

The public panel remains on Step 1. After a member clicks a path, their remaining onboarding flow is ephemeral/private so one recruit does not overwrite another recruit's screen.

## Role configuration

Empty role IDs are ignored, so the interface can be tested before roles are configured.

The bot removes other configured roles in the same category before adding the newly selected role.

## Railway

Place these files at the root of the Railway service/repository, then use:

```text
node index.js
```

Environment variables:

```text
DISCORD_TOKEN=your_bot_token
GUILD_ID=1352675653798989947
```

This bot is a worker and does not require a public HTTP port.
