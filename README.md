# 1st M.I. Combined Bot

One Discord bot for:

1. **After Action Reports** — reports, points, PL snapshots, voice reminders  
2. **Looking for Troopers** — LFG posts, recruit alerts (count-based), onboarding alerts  
3. **Tactical Centre** — specialisation question editor (Sentinel / Driller / Top Dog / Doughboy)

## Railway

- Start: `node index.js`
- Env: `TOKEN` or `DISCORD_TOKEN`
- Volume: `/app/data` (stats + specialisations.json + role-tracking.json)

## Developer Portal intents

- Server Members Intent  
- Message Content Intent  
- Guild Voice States (default with voice)

## Commands

### AAR
`/setup` `/drops` `/droplist` `/1stmidrops` `/servermembers` `/setstats` `/settotal` `/setall` `/undolast` `/testreminder` `/plpanel`

### Looking for Troopers
`/count` `/check` `/lfttest` `/lftpost` `/rctpost`

### Rank tracking
`/ranklist` `/ranktest` `/syncroles` `/memberlookup` `/restoremember`

### Activity stats
`/me` `/userstats` `/top`

### Tactical Centre
No slash commands — uses permanent **Edit … Questions** buttons in the four specialisation threads.

### Build Certification
`/buildpanel` `/buildreload`

## Folders

- `images/` — LFG / Waiting for Game trooper images (count-based)
  - Naming: `trooper_01_a.png`, `trooper_01_b.jpg`, `trooper_01_c.jpg` … up to `trooper_16_c`
  - 3 varieties (a/b/c) per count 1–16. Bot rotates varieties and picks by exact number of people in the voice channel.
- `recruit_alert_images/` — recruit alert images
  - Naming: `recruit_alert_01.png` … `recruit_alert_10.png`
  - Selected by the number of recruits currently in Waiting for Game (including the one who just joined).
- `data/specialisations.json` — TAC question bank  
- `aar-reminder.mp3` — AAR voice reminder  

## LFT / Recruit behaviour highlights

- When a recruit joins **Waiting for Game**, the bot counts *all* recruits already present (with a short delay to handle Discord voice cache lag) and posts a single alert with the correct count + matching image.
- Recruit reminder timer also uses the current count image.
- Company role routing (Demon / Nightmare / Cerberus / Hellfire) sends rank milestone notices to the matching leadership channel and pings the two leadership roles configured for that company. No default fallback channel.
- `/ranklist` is a public channel post. Run it in a company leadership channel to filter to that company.
- `/ranktest @user` shows which company channel(s) + roles would be pinged, and also pings the test roles in the channel where the command is run.
- Role grant: if a member has either `1317610310705741834` or `1319450021426495499`, they are given `1294781406295363705` (if missing). Runs on role add, join, startup, and `/syncroles`. Bot role must be above the granted role and have Manage Roles.
- Member backup: nickname + roles are saved on change, timeout, kick/leave, and startup. Admins with Manage Roles use `/memberlookup` and `/restoremember`. Restore adds missing roles and sets the saved nick; it does not strip extra roles. View Audit Log is optional (used to label kick vs leave).
- Activity stats: `/me`, `/userstats`, and `/top` track messages and voice time in 1d / 7d / 45d windows (UTC). Tracking starts when this module is deployed — old Statbot hours cannot be imported without their premium API. Voice sessions already in progress at startup are picked up.

## Important

Stop any separate AAR / LFT / TAC bots before deploying — one token, one process.
