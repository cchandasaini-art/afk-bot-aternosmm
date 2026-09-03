const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const express = require('express');

// Look for Railway variables first, fallback to settings.json if blank
let config;
try {
  config = require('./settings.json');
} catch (e) {
  config = { name: "Minecraft AFK Bot" };
}

const SERVER_IP = process.env.IP || (config.server ? config.server.ip : "localhost");
const SERVER_PORT = process.env.PORT ? parseInt(process.env.PORT) : (config.server ? parseInt(config.server.port) : 25565);
const BOT_NAME = process.env.USERNAME || (config.server ? config.server.username : "AFK_Bot");

// ============================================================
// EXPRESS SERVER - Keep Render/Railway/Aternos alive
// ============================================================
const app = express();
const PORT = process.env.PORT_EXPRESS || process.env.PORT || 5000; // Shift Express port if 5000 is grabbed by system

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  coords: { x: 0, y: 0, z: 0 },
  errors: []
};

// JSON endpoint for dashboard fetching
app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: botState.connected ? botState.coords : null,
    attempts: botState.reconnectAttempts
  });
});

// Live Dashboard View Route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${config.name || "Bot"} Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .container { background: #1e293b; padding: 40px; border-radius: 20px; box-shadow: 0 0 50px rgba(45, 212, 191, 0.2); text-align: center; width: 400px; border: 1px solid #334155; }
          h1 { margin-bottom: 30px; font-size: 24px; color: #ccfbf1; display: flex; align-items: center; justify-content: center; gap: 10px; }
          .stat-card { background: #0f172a; padding: 15px; margin: 15px 0; border-radius: 12px; border-left: 5px solid #2dd4bf; text-align: left; }
          .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; }
          .value { font-size: 18px; font-weight: bold; color: #2dd4bf; margin-top: 5px; }
          .status-dot { height: 12px; width: 12px; border-radius: 50%; display: inline-block; margin-right: 8px; background-color: currentColor; }
          .pulse { animation: pulse 2s infinite; }
          @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1><span id="live-indicator" class="status-dot pulse" style="color: #ef4444;"></span> ${config.name || "Bot"}</h1>
          <div class="stat-card"><div class="label">Status</div><div class="value" id="status-text">Connecting...</div></div>
          <div class="stat-card"><div class="label">Uptime</div><div class="value" id="uptime-text">0h 0m 0s</div></div>
          <div class="stat-card"><div class="label">Coordinates</div><div class="value" id="coords-text">Waiting...</div></div>
          <div class="stat-card"><div class="label">Server</div><div class="value">${SERVER_IP}:${SERVER_PORT}</div></div>
        </div>
        <script>
          const formatUptime = (s) => { return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m '+(s%60)+'s'; };
          setInterval(async () => {
            try {
              const res = await fetch('/health');
              const data = await res.json();
              document.getElementById('uptime-text').innerText = formatUptime(data.uptime);
              if (data.status === 'connected') {
                document.getElementById('status-text').innerHTML = '<span class="status-dot" style="color: #4ade80;"></span> Online';
                document.getElementById('live-indicator').style.color = '#4ade80';
                if(data.coords) document.getElementById('coords-text').innerText = 'X: ' + Math.floor(data.coords.x) + ' Y: ' + Math.floor(data.coords.y) + ' Z: ' + Math.floor(data.coords.z);
              } else {
                document.getElementById('status-text').innerHTML = '<span class="status-dot" style="color: #f87171;"></span> Offline';
                document.getElementById('live-indicator').style.color = '#f87171';
                document.getElementById('coords-text').innerText = 'Reconnecting...';
              }
            } catch(e) {}
          }, 2000);
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`[Dashboard Server] Listening live on Port ${PORT}`);
});

// ============================================================
// MINECFLAYER LOGIC - Reconnect Loop + Anti-AFK Features
// ============================================================
let bot;
let activityInterval;

function startBot() {
  console.log(`[Mineflayer] Connecting to ${SERVER_IP}:${SERVER_PORT} as ${BOT_NAME}...`);
  
  bot = mineflayer.createBot({
    host: SERVER_IP,
    port: SERVER_PORT,
    username: BOT_NAME,
    version: false, // Auto-negotiate Minecraft server build version
    hideErrors: true
  });

  bot.loadPlugin(pathfinder);

  bot.on('spawn', () => {
    botState.connected = true;
    botState.reconnectAttempts = 0;
    console.log(`[Mineflayer] Success! ${BOT_NAME} has entered the map.`);
    
    // Track location changes
    botState.coords = bot.entity.position;

    // Fix Aternos 24H sleep: Jump, look around, and swing arm every 45 seconds to prove activity
    clearInterval(activityInterval);
    activityInterval = setInterval(() => {
      if (!botState.connected) return;
      try {
        // Update dashboard coords tracking
        botState.coords = bot.entity.position;
        
        // Anti-AFK Routine
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
        bot.look(Math.random() * 360, (Math.random() * 40) - 20);
        bot.swingArm('right');
        
        console.log(`[Anti-AFK] Triggered movement tick at coordinates: ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.z)}`);
      } catch (err) {
        console.log('[Anti-AFK] Failed moving player coordinates.');
      }
    }, 45000);
  });

  // Handle server kicks or 24-Hour automated structural maintenance drops
  bot.on('end', (reason) => {
    botState.connected = false;
    clearInterval(activityInterval);
    console.log(`[Mineflayer] Disconnected from server. Reason: ${reason}`);
    
    botState.reconnectAttempts++;
    console.log(`[Auto-Recovery] Retrying execution window in 20 seconds (Attempt #${botState.reconnectAttempts})`);
    setTimeout(startBot, 20000);
  });

  bot.on('error', (err) => {
    console.log(`[Mineflayer Error] Connection dropped: ${err.message}`);
  });
}

// Fire up the engine!
startBot();

     


    
      
       
