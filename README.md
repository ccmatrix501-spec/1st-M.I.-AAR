# 1st Mobile Infantry Onboarding Bot — Personal Test Server

Locked to Discord server `1352675653798989947` by default.

## Changes in this build

- Step 1 uses a clean **2 × 2** real Discord button layout.
- Step 2 region choices use compact real Discord buttons.
- Step 3 branches correctly:
  - Starship Troopers / Hell Let Loose: Vietnam → Platform.
  - Ambassador / Returning Member → Rules & Conduct.
- All existing path, region, platform, experience and returning-rank role assignment remains supported.
- When `/onboarding-panel` is posted, the command now asks you to choose the **Recruit role**.
- Every member who reaches the end of onboarding is automatically given that Recruit role.
- The final completion card now displays **STATUS: RECRUIT** instead of the privacy message.
- The final screen has **no Start Over button**.
- `/reset-onboarding` is still available for testing/admin use, but it is not shown to members at completion.

## Posting the onboarding panel

Run:

```text
/onboarding-panel recruit-role:@Recruit
```

Discord will give you a role picker for `recruit-role`, so you do not need to hard-code the final Recruit role before posting the panel.

The bot checks that:

- the selected role is not a Discord/integration-managed role; and
- the bot's highest role is above the selected Recruit role.

The chosen Recruit role ID is carried through the onboarding controls so members can receive the correct role when they finish.

`config.json` also contains an optional `roles.recruit` fallback value, but the role selected when posting the panel is the normal method.

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

### Step 4+

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

### Completion

After the final answer:

1. the configured/selected roles from onboarding remain applied;
2. the Recruit role chosen when the panel was posted is added;
3. the completion card is shown with **STATUS: RECRUIT**; and
4. there is no **Start Over** button.

## Custom Starship Troopers / HLL button emblems

Discord buttons cannot use PNG/JPG/WebP files directly. Upload the supplied emblems to Discord as custom server emojis, then place their numeric IDs into `config.json`:

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

Blank values safely fall back to normal Unicode icons.

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
5. Put the bot's Discord role above all roles it should assign, including Recruit.
6. Create a `.env` file and set:

```text
DISCORD_TOKEN=your_bot_token
```

7. Put any path/region/platform/etc. role IDs into `config.json`.
8. Optional: upload custom emblems as Discord server emojis and put their IDs in `config.json`.
9. Run:

```bash
npm install
npm start
```

10. Post the panel with:

```text
/onboarding-panel recruit-role:@Recruit
```

The public panel remains on Step 1. After someone clicks a path, their remaining onboarding flow is ephemeral/private so one recruit cannot overwrite another person's onboarding screen.

## Role configuration

Empty category role IDs are ignored, so the flow can be tested before every role is configured.

The bot removes other configured roles in the same category before adding the newly selected category role.

## Railway

Place these files at the root of the Railway service/repository and use:

```text
node index.js
```

Environment variables:

```text
DISCORD_TOKEN=your_bot_token
GUILD_ID=1352675653798989947
```

This bot is a worker and does not require a public HTTP port.
