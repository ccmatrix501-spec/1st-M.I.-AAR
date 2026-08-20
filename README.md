# 1st Mobile Infantry Onboarding Bot — Discord Components V2

This build replaces the old PNG-card/fake-button presentation with **native Discord Components V2**.

## What changed

- The onboarding interface is now rendered by Discord itself using a native Components V2 **Container**.
- The 1st M.I. logo appears as the native section thumbnail.
- Questions and descriptions are native Discord text, so they scale properly on desktop and mobile.
- Every visible choice is a real Discord button.
- The public Step 1 panel stays available for new members.
- After a member selects a path, the rest of their onboarding is private/ephemeral.
- Step 1 → Step 2 → branching Step 3 behaviour is preserved.
- The Recruit role is selected when `/onboarding-panel` is posted and is awarded when onboarding is complete.
- The final screen says **STATUS: RECRUIT** and contains no Start Over button.

## Flow

### Step 1 — What are you here for?

- Starship Troopers
- Hell Let Loose: Vietnam
- Ambassador
- Returning Member

The selected path role can be assigned automatically through `config.json`.

### Step 2 — Region

- America
- Europe
- Asia
- Africa
- Oceania

### Step 3

**Starship Troopers / Hell Let Loose: Vietnam**

- PC
- Xbox
- PlayStation

**Ambassador / Returning Member**

- Rules & Conduct
- I Agree / I Do Not Agree

### Step 4+

**Starship Troopers / Hell Let Loose: Vietnam**

- Experience selection
- Completion → Recruit role

**Ambassador**

- Community / Unit Name modal
- Completion → Recruit role

**Returning Member**

- Previous 1st M.I. name modal
- Previous rank / role
- Completion → Recruit role

## Post the onboarding panel

Run:

```text
/onboarding-panel recruit-role:@Recruit
```

The bot verifies that it can assign the selected Recruit role before posting the panel.

## Custom game emblems on buttons

Discord native buttons can use custom server emojis. Upload the supplied Starship Troopers and Hell Let Loose emblems as emojis, then place their numeric emoji IDs into `config.json`:

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

If left blank, normal Unicode icons are used.

## Role configuration

All category role IDs are optional. Empty IDs are ignored.

```json
"roles": {
  "recruit": "",
  "paths": {
    "starship": "",
    "hllv": "",
    "ambassador": "",
    "returning": ""
  },
  "regions": {
    "america": "",
    "europe": "",
    "asia": "",
    "africa": "",
    "oceania": ""
  },
  "platforms": {
    "pc": "",
    "xbox": "",
    "playstation": ""
  },
  "experience": {
    "new": "",
    "some": "",
    "veteran": "",
    "expert": ""
  },
  "ranks": {
    "squad_member": "",
    "squad_lead": "",
    "platoon_lead": "",
    "nco": "",
    "officer": ""
  }
}
```

The bot removes other configured roles in the same category before adding a newly selected role.

## Setup

1. Install Node.js 20 or newer.
2. Create a Discord application/bot.
3. Enable **Server Members Intent** in the Discord Developer Portal.
4. Give the bot:
   - View Channels
   - Send Messages
   - Read Message History
   - Manage Roles
   - Use Application Commands
5. Put the bot role above every role it needs to assign.
6. Create a `.env` file:

```text
DISCORD_TOKEN=your_bot_token
```

7. Set your server ID and optional role IDs in `config.json`.
8. Run:

```bash
npm install
npm start
```

## Railway

Use these environment variables:

```text
DISCORD_TOKEN=your_bot_token
GUILD_ID=your_server_id
```

Start command:

```text
node index.js
```

This is a worker bot and does not require a public HTTP port.
