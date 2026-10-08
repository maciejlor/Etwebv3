const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const VTC_ID = '74784';
const TMP_API_URL = 'https://api.truckersmp.com/v2/vtc/' + VTC_ID + '/events';
const TMP_PARTNERS_URL = 'https://api.truckersmp.com/v2/vtc/' + VTC_ID + '/partners';
const TMP_NEWS_URL = 'https://api.truckersmp.com/v2/vtc/' + VTC_ID + '/news';

let cachedEvents = null;
let lastEventsFetchTime = 0;
let cachedPartners = null;
let lastPartnersFetchTime = 0;
let cachedNews = null;
let lastNewsFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000;

// Synchronously preload all caches from disk at boot for instantaneous 0ms responses
try {
  const diskEvents = path.join(__dirname, 'events.json');
  if (fs.existsSync(diskEvents)) {
    cachedEvents = JSON.parse(fs.readFileSync(diskEvents, 'utf8'));
    lastEventsFetchTime = Date.now();
    console.log('[Cache Init] Preloaded events.json into RAM');
  }
} catch (e) {}

try {
  const diskPartners = path.join(__dirname, 'partners.json');
  if (fs.existsSync(diskPartners)) {
    cachedPartners = JSON.parse(fs.readFileSync(diskPartners, 'utf8'));
    lastPartnersFetchTime = Date.now();
    console.log('[Cache Init] Preloaded partners.json into RAM');
  }
} catch (e) {}

try {
  const diskNews = path.join(__dirname, 'news.json');
  if (fs.existsSync(diskNews)) {
    cachedNews = JSON.parse(fs.readFileSync(diskNews, 'utf8'));
    lastNewsFetchTime = Date.now();
    console.log('[Cache Init] Preloaded news.json into RAM');
  }
} catch (e) {}

let isFetchingEvents = false;
function refreshEventsInBackground() {
  if (isFetchingEvents) return;
  isFetchingEvents = true;
  const options = {
    headers: {
      'User-Agent': 'TruckersMP-VTC-Site/1.0 (contact: info@eternaltransport.com)',
      'Accept': 'application/json'
    }
  };
  https.get(TMP_API_URL, options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      isFetchingEvents = false;
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const parsed = JSON.parse(data);
          cachedEvents = parsed;
          lastEventsFetchTime = Date.now();
          fs.writeFile(path.join(__dirname, 'events.json'), JSON.stringify(parsed, null, 2), 'utf8', () => {});
        }
      } catch (e) {}
    });
  }).on('error', () => { isFetchingEvents = false; });
}

function fetchTruckersMpEvents() {
  return new Promise((resolve, reject) => {
    if (cachedEvents) {
      // If cache is older than TTL, refresh in background without stalling client
      if (Date.now() - lastEventsFetchTime > CACHE_TTL_MS) {
        refreshEventsInBackground();
      }
      return resolve(cachedEvents);
    }

    const options = {
      headers: {
        'User-Agent': 'TruckersMP-VTC-Site/1.0 (contact: info@eternaltransport.com)',
        'Accept': 'application/json'
      }
    };

    https.get(TMP_API_URL, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            cachedEvents = parsed;
            lastEventsFetchTime = Date.now();
            fs.writeFile(path.join(__dirname, 'events.json'), JSON.stringify(parsed, null, 2), 'utf8', () => {});
            resolve(parsed);
          } else {
            fallbackFromDisk('events.json', resolve, reject, 'TruckersMP returned HTTP ' + res.statusCode);
          }
        } catch (e) {
          fallbackFromDisk('events.json', resolve, reject, e.message);
        }
      });
    }).on('error', (err) => {
      fallbackFromDisk('events.json', resolve, reject, err.message);
    });
  });
}

function fetchTruckersMpPartners() {
  return new Promise((resolve, reject) => {
    if (cachedPartners && (Date.now() - lastPartnersFetchTime < CACHE_TTL_MS)) {
      return resolve(cachedPartners);
    }

    const options = {
      headers: {
        'User-Agent': 'TruckersMP-VTC-Site/1.0 (contact: info@eternaltransport.com)',
        'Accept': 'application/json'
      }
    };

    https.get(TMP_PARTNERS_URL, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            cachedPartners = parsed;
            lastPartnersFetchTime = Date.now();
            fs.writeFile(path.join(__dirname, 'partners.json'), JSON.stringify(parsed, null, 2), 'utf8', () => {});
            resolve(parsed);
          } else {
            fallbackFromDisk('partners.json', resolve, reject, 'TruckersMP returned HTTP ' + res.statusCode);
          }
        } catch (e) {
          fallbackFromDisk('partners.json', resolve, reject, e.message);
        }
      });
    }).on('error', (err) => {
      fallbackFromDisk('partners.json', resolve, reject, err.message);
    });
  });
}

const TMP_AUTHOR_AVATARS = {
  3489028: 'https://static.truckersmp.com/avatarsN/small/3489028.1777647187.png',
  5462922: 'https://static.truckersmp.com/avatarsN/small/5462922.1746920493.png',
  4681383: 'https://static.truckersmp.com/avatarsN/small/4681383.1742914798.png',
  6013967: 'https://static.truckersmp.com/avatarsN/small/6013967.1773698623.jpg'
};

function enrichNewsWithAvatars(data) {
  if (!data) return data;
  const clone = JSON.parse(JSON.stringify(data));
  if (clone.response && Array.isArray(clone.response.news)) {
    clone.response.news.forEach(item => {
      if (item && item.author_id) {
        item.author_avatar = TMP_AUTHOR_AVATARS[item.author_id] || null;
      }
    });
  } else if (clone.response && clone.response.author_id) {
    clone.response.author_avatar = TMP_AUTHOR_AVATARS[clone.response.author_id] || null;
  }
  return clone;
}

function fetchTruckersMpNews() {
  return new Promise((resolve, reject) => {
    if (cachedNews && (Date.now() - lastNewsFetchTime < CACHE_TTL_MS)) {
      return resolve(cachedNews);
    }

    const options = {
      headers: {
        'User-Agent': 'TruckersMP-VTC-Site/1.0 (contact: info@eternaltransport.com)',
        'Accept': 'application/json'
      }
    };

    https.get(TMP_NEWS_URL, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            cachedNews = parsed;
            lastNewsFetchTime = Date.now();
            fs.writeFile(path.join(__dirname, 'news.json'), JSON.stringify(parsed, null, 2), 'utf8', () => {});
            resolve(parsed);
          } else {
            fallbackFromDisk('news.json', resolve, reject, 'TruckersMP returned HTTP ' + res.statusCode);
          }
        } catch (e) {
          fallbackFromDisk('news.json', resolve, reject, e.message);
        }
      });
    }).on('error', (err) => {
      fallbackFromDisk('news.json', resolve, reject, err.message);
    });
  });
}

function fetchTruckersMpSingleNews(newsId) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'TruckersMP-VTC-Site/1.0 (contact: info@eternaltransport.com)',
        'Accept': 'application/json'
      }
    };

    https.get(TMP_NEWS_URL + '/' + newsId, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } else {
            reject(new Error('TruckersMP returned HTTP ' + res.statusCode));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '932199620224901170';

const ALLOWED_TEAM_ROLES = [
  'Owner',
  'Founder',
  'Chief Executive Officer',
  'Chief Operating Officer',
  'Chief Administrative Officer',
  'Leadership Intern',
  'General Manager',
  'HR Manager',
  'Event Manager',
  'Media Manager',
  'Brand Manager',
  'Development Manager',
  'Save Manager',
  'HR Assistant',
  'Event Assistant',
  'Media Assistant',
  'Developer Team',
  'Media Team',
  'HR Team',
  'HR Trainee'
];

let cachedTeam = null;
let lastTeamFetchTime = 0;

try {
  const diskTeam = path.join(__dirname, 'team.json');
  if (fs.existsSync(diskTeam)) {
    cachedTeam = JSON.parse(fs.readFileSync(diskTeam, 'utf8'));
    lastTeamFetchTime = Date.now();
    console.log('[Cache Init] Preloaded team.json into RAM');
  }
} catch (e) {}

function getDiscordBotToken() {
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN.trim()) {
    return process.env.DISCORD_BOT_TOKEN.trim();
  }
  const tokenFiles = ['token.txt', 'discord_token.txt', '.env', 'bot_token.txt'];
  for (const file of tokenFiles) {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (file === '.env') {
          const match = content.match(/DISCORD_BOT_TOKEN\s*=\s*([^\r\n]+)/);
          if (match && match[1]) return match[1].trim().replace(/^["']|["']$/g, '');
        } else if (content.trim()) {
          return content.trim();
        }
      } catch (e) {}
    }
  }
  return '';
}

function matchRoleName(discordRoleName) {
  if (!discordRoleName) return null;
  const clean = discordRoleName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < ALLOWED_TEAM_ROLES.length; i++) {
    const target = ALLOWED_TEAM_ROLES[i].toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    if (clean === target) {
      return { name: ALLOWED_TEAM_ROLES[i], priority: i };
    }
  }
  for (let i = 0; i < ALLOWED_TEAM_ROLES.length; i++) {
    const target = ALLOWED_TEAM_ROLES[i].toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    if (clean.includes(target)) {
      return { name: ALLOWED_TEAM_ROLES[i], priority: i };
    }
  }
  return null;
}

function fetchDiscordApi(apiPath, botToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: '/api/v10' + apiPath,
      method: 'GET',
      headers: {
        'Authorization': 'Bot ' + botToken,
        'User-Agent': 'DiscordBot (https://eternaltransport.com, 1.0)',
        'Accept': 'application/json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Discord API returned HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function fetchDiscordTeam(force = false) {
  if (!force && cachedTeam) {
    return cachedTeam;
  }

  const token = getDiscordBotToken();
  if (!token) {
    return new Promise((resolve, reject) => {
      fallbackFromDisk('team.json', resolve, reject, 'No Discord bot token configured. Falling back to team.json.');
    });
  }

  try {
    const rolesData = await fetchDiscordApi(`/guilds/${DISCORD_GUILD_ID}/roles`, token);
    const roleMap = new Map();
    for (const r of rolesData) {
      const match = matchRoleName(r.name);
      if (match) {
        roleMap.set(r.id, {
          id: r.id,
          originalName: r.name,
          standardName: match.name,
          priority: match.priority,
          color: r.color ? ('#' + r.color.toString(16).padStart(6, '0')) : null,
          icon: r.icon ? `https://cdn.discordapp.com/role-icons/${r.id}/${r.icon}.png?size=48` : null
        });
      }
    }

    const rolesMeta = {};
    for (const roleObj of roleMap.values()) {
      if (!rolesMeta[roleObj.standardName] || (!rolesMeta[roleObj.standardName].icon && roleObj.icon)) {
        rolesMeta[roleObj.standardName] = {
          name: roleObj.standardName,
          color: roleObj.color,
          icon: roleObj.icon
        };
      }
    }

    const membersData = await fetchDiscordApi(`/guilds/${DISCORD_GUILD_ID}/members?limit=1000`, token);
    const filteredMembers = [];

    for (const m of membersData) {
      if (!m.user || m.user.bot) continue;
      const userRoles = [];
      for (const rId of (m.roles || [])) {
        if (roleMap.has(rId)) {
          userRoles.push(roleMap.get(rId));
        }
      }
      if (userRoles.length === 0) continue;

      userRoles.sort((a, b) => a.priority - b.priority);
      const topRole = userRoles[0];
      filteredMembers.push({ m, topRole, allRoles: userRoles.map(r => r.standardName) });
    }

    filteredMembers.sort((a, b) => a.topRole.priority - b.topRole.priority);

    // Enrich profiles with User endpoint for avatar decorations, banners, and banner colors
    const teamMembers = [];
    for (let i = 0; i < filteredMembers.length; i++) {
      const { m, topRole, allRoles } = filteredMembers[i];
      const u = m.user;

      let fullUser = u;
      try {
        fullUser = await fetchDiscordApi(`/users/${u.id}`, token);
      } catch (e) {}

      // Avatar Resolution
      let avatarUrl = '';
      const avatarHash = m.avatar || fullUser.avatar;
      if (avatarHash) {
        const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
        if (m.avatar) {
          avatarUrl = `https://cdn.discordapp.com/guilds/${DISCORD_GUILD_ID}/users/${u.id}/avatars/${m.avatar}.${ext}?size=256`;
        } else {
          avatarUrl = `https://cdn.discordapp.com/avatars/${u.id}/${fullUser.avatar}.${ext}?size=256`;
        }
      } else {
        const defaultIndex = (BigInt(u.id) >> 22n) % 6n;
        avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
      }

      // Avatar Decoration Resolution (Effort / Decoration)
      let decorationUrl = null;
      const decoData = fullUser.avatar_decoration_data || m.user.avatar_decoration_data;
      if (decoData && decoData.asset) {
        decorationUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decoData.asset}.png?size=240&passthrough=true`;
      }

      // Banner Resolution
      let bannerUrl = null;
      const bannerHash = m.banner || fullUser.banner;
      if (bannerHash) {
        const ext = bannerHash.startsWith('a_') ? 'gif' : 'png';
        if (m.banner) {
          bannerUrl = `https://cdn.discordapp.com/guilds/${DISCORD_GUILD_ID}/users/${u.id}/banners/${m.banner}.${ext}?size=600`;
        } else {
          bannerUrl = `https://cdn.discordapp.com/banners/${u.id}/${fullUser.banner}.${ext}?size=600`;
        }
      }

      // Banner Color
      let bannerColor = fullUser.banner_color || null;
      if (!bannerColor && fullUser.accent_color) {
        bannerColor = '#' + fullUser.accent_color.toString(16).padStart(6, '0');
      }

      // Clan Tag
      const clanTag = (fullUser.clan && fullUser.clan.tag) ? fullUser.clan.tag : (m.clan && m.clan.tag ? m.clan.tag : null);

      teamMembers.push({
        id: u.id,
        username: u.username,
        name: m.nick || fullUser.global_name || u.username,
        avatar: avatarUrl,
        decoration: decorationUrl,
        banner: bannerUrl,
        bannerColor: bannerColor,
        clanTag: clanTag,
        primaryRole: topRole.standardName,
        roleIcon: topRole.icon || null,
        priority: topRole.priority,
        color: topRole.color || '#c084fc',
        roles: allRoles,
        status: 'Active Staff'
      });

      // Brief delay between profile fetches to avoid rate limits
      await new Promise(r => setTimeout(r, 45));
    }

    const result = {
      updatedAt: new Date().toISOString(),
      guildId: DISCORD_GUILD_ID,
      count: teamMembers.length,
      rolesMeta: rolesMeta,
      members: teamMembers
    };

    cachedTeam = result;
    lastTeamFetchTime = Date.now();
    fs.writeFile(path.join(__dirname, 'team.json'), JSON.stringify(result, null, 2), 'utf8', () => {});
    return result;
  } catch (err) {
    return new Promise((resolve, reject) => {
      fallbackFromDisk('team.json', resolve, reject, err.message);
    });
  }
}

function fallbackFromDisk(filename, resolve, reject, errReason) {
  const diskPath = path.join(__dirname, filename);
  if (fs.existsSync(diskPath)) {
    try {
      const diskData = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
      return resolve(diskData);
    } catch (e) {}
  }
  reject(new Error(errReason));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsedUrl.pathname;

  const apiEventDetailMatch = pathname.match(/^\/api\/events?\/(\d+)$/);
  if (apiEventDetailMatch) {
    const eventId = parseInt(apiEventDetailMatch[1], 10);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const data = await fetchTruckersMpEvents();
      const list = (data && data.response) ? data.response : [];
      const event = list.find(e => Number(e.id) === eventId);
      if (event) {
        res.writeHead(200);
        res.end(JSON.stringify({ error: false, response: event }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: true, message: 'Event not found' }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: true, message: err.message }));
    }
    return;
  }

  if (pathname === '/api/events' || pathname === '/api/truckersmp/events') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const data = await fetchTruckersMpEvents();
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: true, message: err.message }));
    }
    return;
  }

  if (pathname === '/api/partners' || pathname === '/api/truckersmp/partners') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const data = await fetchTruckersMpPartners();
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: true, message: err.message }));
    }
    return;
  }

  const apiNewsDetailMatch = pathname.match(/^\/api\/news\/(\d+)$/);
  if (apiNewsDetailMatch) {
    const newsId = parseInt(apiNewsDetailMatch[1], 10);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const singleData = await fetchTruckersMpSingleNews(newsId);
      res.writeHead(200);
      res.end(JSON.stringify(enrichNewsWithAvatars(singleData)));
    } catch (err) {
      try {
        const allData = await fetchTruckersMpNews();
        const list = (allData && allData.response && allData.response.news) ? allData.response.news : [];
        const item = list.find(n => Number(n.id) === newsId);
        if (item) {
          res.writeHead(200);
          res.end(JSON.stringify(enrichNewsWithAvatars({ error: false, response: item })));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: true, message: 'News not found' }));
        }
      } catch (fallbackErr) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: true, message: err.message }));
      }
    }
    return;
  }

  if (pathname === '/api/news' || pathname === '/api/truckersmp/news') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const data = await fetchTruckersMpNews();
      res.writeHead(200);
      res.end(JSON.stringify(enrichNewsWithAvatars(data)));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: true, message: err.message }));
    }
    return;
  }

  if (pathname === '/api/team' || pathname === '/api/discord/team') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const data = await fetchDiscordTeam();
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: true, message: err.message }));
    }
    return;
  }

  let relativePath = pathname === '/' ? '/index.html' : pathname;
  if (pathname === '/aboutus' || pathname === '/aboutus/') {
    relativePath = '/aboutus.html';
  } else if (pathname === '/events' || pathname === '/events/' || pathname === '/event' || pathname === '/event/') {
    relativePath = '/events.html';
  } else if (/^\/events?\/(\d+)\/?$/.test(pathname)) {
    relativePath = '/event-detail.html';
  } else if (pathname === '/news' || pathname === '/news/' || /^\/news\/(\d+)\/?$/.test(pathname)) {
    relativePath = '/news.html';
  } else if (pathname === '/gallery' || pathname === '/gallery/') {
    relativePath = '/gallery.html';
  } else if (pathname === '/terms' || pathname === '/terms/' || pathname === '/policies' || pathname === '/policies/') {
    relativePath = '/terms.html';
  } else if (pathname === '/partners' || pathname === '/partners/' || pathname === '/partner' || pathname === '/partner/') {
    relativePath = '/partners.html';
  } else if (pathname === '/404' || pathname === '/404/') {
    relativePath = '/404.html';
  }
  const safePath = path.normalize(decodeURIComponent(relativePath)).replace(/^(\.\.[\\/])+/, '');
  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const page404 = path.join(__dirname, '404.html');
      if (fs.existsSync(page404)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(page404).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const statusCode = (pathname === '/404' || pathname === '/404/' || pathname === '/404.html') ? 404 : 200;
    res.writeHead(statusCode, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('[Etwebv3 Dev Server] Running at http://localhost:' + PORT);
  console.log('[Etwebv3 Dev Server] TruckersMP API Proxy at http://localhost:' + PORT + '/api/events');
  console.log('[Etwebv3 Dev Server] TruckersMP Partners Proxy at http://localhost:' + PORT + '/api/partners');
  console.log('[Etwebv3 Dev Server] Discord Team Proxy at http://localhost:' + PORT + '/api/team');
});

// Periodic Discord team refresh every 60 seconds (1 minute)
setInterval(async () => {
  try {
    await fetchDiscordTeam(true);
    console.log('[Discord Sync] Updated team data at ' + new Date().toLocaleTimeString());
  } catch (err) {
    console.error('[Discord Sync Error]', err.message);
  }
}, 60 * 1000);

// Initial immediate sync on server start
setTimeout(async () => {
  try {
    await fetchDiscordTeam(true);
    console.log('[Discord Sync] Initial team sync completed.');
  } catch (err) {
    console.error('[Discord Sync Initial Error]', err.message);
  }
}, 1000);
