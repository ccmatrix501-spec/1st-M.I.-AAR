# 1st M.I. After Action Report Bot

## Local Setup
1. Copy `.env.example` to `.env` and add your bot token
2. npm install
3. node index.js

## Railway Settings
- Start Command: `node index.js`
- Build Command: leave empty (or `npm install`)
- Volume Mount Path: `/app/data`
- Public Domain: generate one and use port from process.env.PORT
