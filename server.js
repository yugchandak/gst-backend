const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 5050;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = path.join(__dirname, 'db.json');
const GST_DATA_PATH = path.join(__dirname, 'gst_data.json');
const USERS_PATH = path.join(__dirname, 'users.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TOOLS_DIR = path.join(__dirname, '..', 'tools');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

let cache = loadDatabase();
let usersCache = loadUsers();
let lastLoaded = Date.now();

// Function to load GST data and merge with db.json
function loadGSTData() {
  try {
    const gstRaw = fs.readFileSync(GST_DATA_PATH, 'utf-8');
    return JSON.parse(gstRaw);
  } catch (error) {
    console.warn('[backend] gst_data.json not found, using default db.json');
    return null;
  }
}

fs.watchFile(DB_PATH, { interval: 1000 }, () => {
  cache = loadDatabase();
  lastLoaded = Date.now();
  console.log('[backend] database reloaded');
});

// Also watch GST data file for changes
fs.watchFile(GST_DATA_PATH, { interval: 1000 }, () => {
  cache = loadDatabase();
  lastLoaded = Date.now();
  console.log('[backend] GST data reloaded');
});

fs.watchFile(USERS_PATH, { interval: 1000 }, () => {
  usersCache = loadUsers();
  console.log('[backend] users reloaded');
});

function loadDatabase() {
  try {
    // Try to load GST data first (priority)
    const gstData = loadGSTData();
    if (gstData) {
      console.log('[backend] GST data loaded from gst_data.json');
      return withDefaults(gstData);
    }
    
    // Fall back to db.json
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return withDefaults(JSON.parse(raw));
  } catch (error) {
    console.error('[backend] failed to read database', error);
    return withDefaults({ sets: [], articles: [], trending: [], plans: [], aiMessages: [] });
  }
}

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function withDefaults(data) {
  return {
    sets: data.sets || [],
    articles: data.articles || [],
    trending: data.trending || [],
    plans: data.plans || [],
    aiMessages: data.aiMessages || [],
    notifications: data.notifications || []
  };
}

function send(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function handleMultipartUpload(req, res) {
  const boundary = req.headers['content-type']?.split('boundary=')[1];
  if (!boundary) {
    return send(res, 400, { error: 'No boundary found' });
  }

  let buffer = Buffer.alloc(0);
  
  req.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 50 * 1024 * 1024) {
      return send(res, 413, { error: 'File too large' });
    }
  });

  req.on('end', async () => {
    try {
      const parts = buffer.toString('binary').split('--' + boundary);
      let pdfBuffer = null;
      let fileName = 'upload.pdf';

      for (const part of parts) {
        if (part.includes('Content-Type: application/pdf')) {
          const nameMatch = part.match(/filename="([^"]+)"/);
          if (nameMatch) fileName = nameMatch[1];
          
          const dataStart = part.indexOf('\r\n\r\n') + 4;
          const dataEnd = part.lastIndexOf('\r\n');
          pdfBuffer = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
          break;
        }
      }

      if (!pdfBuffer) {
        return send(res, 400, { error: 'No PDF file found in upload' });
      }

      const safeName = `${Date.now()}-${fileName.replace(/\s+/g, '_')}`;
      const dest = path.join(UPLOADS_DIR, safeName);
      fs.writeFileSync(dest, pdfBuffer);

      try {
        const stats = await runExtraction(dest);
        return send(res, 200, {
          success: true,
          message: 'PDF uploaded and data extracted successfully',
          fileName: safeName,
          ...stats
        });
      } catch (extractErr) {
        return send(res, 200, {
          success: false,
          message: 'PDF uploaded but extraction failed',
          fileName: safeName,
          error: extractErr.message
        });
      }
    } catch (err) {
      return send(res, 500, { error: 'Upload processing failed: ' + err.message });
    }
  });

  req.on('error', (err) => {
    send(res, 500, { error: err.message });
  });
}

function persistData() {
  const target = fs.existsSync(GST_DATA_PATH) ? GST_DATA_PATH : DB_PATH;
  fs.writeFileSync(target, JSON.stringify(cache, null, 2));
  cache = loadDatabase();
}

function persistUsers() {
  fs.writeFileSync(USERS_PATH, JSON.stringify(usersCache, null, 2));
  usersCache = loadUsers();
}

function serveStatic(res, filePath, contentType = 'text/html') {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  } catch (err) {
    send(res, 404, { error: 'File not found' });
  }
}

function runExtraction(pdfPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(TOOLS_DIR, 'pdf_extraction_tool.py');
    const args = [scriptPath, pdfPath, '--output', GST_DATA_PATH];
    const proc = spawn('python3', args, { cwd: path.join(__dirname, '..') });
    let stderr = '';
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    proc.on('close', code => {
      if (code === 0) {
        cache = loadDatabase();
        const gstData = loadGSTData();
        const stats = {
          totalArticles: cache.articles.length,
          categories: {}
        };
        
        // Count articles by category
        cache.articles.forEach(article => {
          const cat = article.category || 'Other';
          stats.categories[cat] = (stats.categories[cat] || 0) + 1;
        });
        
        resolve(stats);
      } else {
        reject(new Error(stderr || 'Extraction failed'));
      }
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Rewrite /admin/api/* to /api/*
  if (url.pathname.startsWith('/admin/api/')) {
    url.pathname = url.pathname.replace('/admin/api/', '/api/');
  }

  // PDF Extraction Tool
  if (req.method === 'GET' && (url.pathname === '/extract' || url.pathname === '/extract/')) {
    const filePath = path.join(PUBLIC_DIR, 'extract.html');
    return serveStatic(res, filePath, 'text/html');
  }

  // Admin static assets
  if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
    const filePath = path.join(PUBLIC_DIR, 'admin.html');
    return serveStatic(res, filePath, 'text/html');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/admin/')) {
    const safePath = url.pathname.replace('/admin/', '');
    const filePath = path.join(PUBLIC_DIR, safePath);
    const ext = path.extname(filePath);
    const type = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/plain';
    return serveStatic(res, filePath, type);
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, {
      status: 'ok',
      updatedAt: lastLoaded,
      counts: {
        sets: cache.sets.length,
        articles: cache.articles.length,
        trending: cache.trending.length,
        plans: cache.plans.length,
        aiMessages: cache.aiMessages.length,
        notifications: cache.notifications.length,
        users: usersCache.length
      },
      data: {
        sets: cache.sets,
        articles: cache.articles,
        trending: cache.trending,
        plans: cache.plans,
        aiMessages: cache.aiMessages,
        notifications: cache.notifications,
        users: usersCache
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    return send(res, 200, cache);
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    return send(res, 200, usersCache);
  }

  if (req.method === 'POST' && url.pathname === '/api/users') {
    return parseBody(req)
      .then(body => {
        const { phone, name = '', email = '', company = '', notes = '' } = body;
        if (!phone) return send(res, 400, { error: 'phone is required' });
        const entry = {
          id: Date.now().toString(),
          phone,
          name,
          email,
          company,
          notes,
          createdAt: new Date().toISOString()
        };
        usersCache.push(entry);
        persistUsers();
        return send(res, 201, entry);
      })
      .catch(err => send(res, 400, { error: err.message }));
  }

  if (req.method === 'POST' && url.pathname === '/api/notifications') {
    return parseBody(req)
      .then(body => {
        const { title, message } = body;
        if (!title || !message) return send(res, 400, { error: 'title and message are required' });
        const item = {
          id: Date.now().toString(),
          title,
          message,
          createdAt: new Date().toISOString()
        };
        cache.notifications.push(item);
        persistData();
        return send(res, 201, item);
      })
      .catch(err => send(res, 400, { error: err.message }));
  }

  if (req.method === 'POST' && url.pathname === '/api/content') {
    return parseBody(req)
      .then(body => {
        const { kind = 'article', title, category = '', date = '', author = '' } = body;
        if (!title) return send(res, 400, { error: 'title is required' });
        let resolvedCategory = category;
        if (!resolvedCategory) {
          if (kind === 'caseLaw') resolvedCategory = 'Case Law';
          else if (kind === 'circular') resolvedCategory = 'Circulars';
          else resolvedCategory = 'Updates';
        }
        const entry = { title, category: resolvedCategory, date, author };
        cache.articles.push(entry);
        persistData();
        return send(res, 201, entry);
      })
      .catch(err => send(res, 400, { error: err.message }));
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    return handleMultipartUpload(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/upload/pdf') {
    return parseBody(req)
      .then(async body => {
        const { fileName = 'upload.pdf', data } = body;
        if (!data) return send(res, 400, { error: 'data is required (base64)' });
        const buffer = Buffer.from(data, 'base64');
        const safeName = `${Date.now()}-${fileName.replace(/\s+/g, '_')}`;
        const dest = path.join(UPLOADS_DIR, safeName);
        fs.writeFileSync(dest, buffer);
        try {
          await runExtraction(dest);
          persistData();
          return send(res, 201, { ok: true, message: 'Uploaded and extracted', path: dest });
        } catch (err) {
          return send(res, 200, { ok: true, message: 'Uploaded but extraction failed', path: dest, error: err.message });
        }
      })
      .catch(err => send(res, 400, { error: err.message }));
  }

  send(res, 404, { error: 'Route not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[backend] API listening on http://${HOST}:${PORT}`);
});
