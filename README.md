# 1st M.I. After Action Report Bot

Discord bot for the 1st Mobile Infantry unit.

## Features
- After Action Report system with buttons
- Voice channel auto-detect or manual selection
- Points & Dropship tracking
- Live stats API for the website
- Admin commands: `/setstats`, `/settotal`, `/setall`, `/servermembers`

## Setup on Railway
1. Set Start Command to: `node index.js`
2. Add environment variable: `TOKEN=your_bot_token`
3. Add a Volume mounted at `/app/data`

## Commands
- `/setup` - Create panel & report channels
- `/drops @user` - Check personal stats
- `/1stmidrops` - Server totals
- `/servermembers` - List all members with stats
- `/setstats` - Set one member's stats
- `/settotal` - Set server total dropships
- `/setall` - Set points/dropships for everyone
