const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Helper to generate a unique random ID
function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

// Ensure database file and directories exist
function init() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      websites: [],
      snapshots: [],
      logs: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
  }
}

// Read whole DB
function readDb() {
  init();
  try {
    const content = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to read database, resetting database:', error);
    const initialData = { websites: [], snapshots: [], logs: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    return initialData;
  }
}

// Write whole DB
function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write to database:', error);
  }
}

const Database = {
  // Init
  init,

  // --- WEBSITES ---
  getWebsites() {
    return readDb().websites;
  },

  getWebsite(id) {
    return readDb().websites.find(w => w.id === id);
  },

  addWebsite({ name, url, selector, intervalMinutes, whatsappNumber }) {
    const db = readDb();
    const newWebsite = {
      id: generateId(),
      name: name || url,
      url,
      selector: selector || '',
      intervalMinutes: parseInt(intervalMinutes, 10) || 10,
      whatsappNumber: whatsappNumber || '',
      isActive: true,
      lastChecked: null,
      lastChanged: null,
      createdAt: new Date().toISOString()
    };
    db.websites.push(newWebsite);
    writeDb(db);
    return newWebsite;
  },

  updateWebsite(id, updates) {
    const db = readDb();
    const index = db.websites.findIndex(w => w.id === id);
    if (index === -1) return null;

    db.websites[index] = {
      ...db.websites[index],
      ...updates
    };
    writeDb(db);
    return db.websites[index];
  },

  deleteWebsite(id) {
    const db = readDb();
    db.websites = db.websites.filter(w => w.id !== id);
    db.snapshots = db.snapshots.filter(s => s.websiteId !== id);
    db.logs = db.logs.filter(l => l.websiteId !== id);
    writeDb(db);
    return true;
  },

  // --- SNAPSHOTS ---
  getSnapshots(websiteId) {
    return readDb().snapshots.filter(s => s.websiteId === websiteId);
  },

  getLatestSnapshot(websiteId) {
    const snapshots = this.getSnapshots(websiteId);
    if (snapshots.length === 0) return null;
    // Sort by timestamp descending
    snapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return snapshots[0];
  },

  addSnapshot({ websiteId, rawHtml, text, statusCode }) {
    const db = readDb();
    const newSnapshot = {
      id: generateId(),
      websiteId,
      timestamp: new Date().toISOString(),
      rawHtml,
      text,
      statusCode
    };
    db.snapshots.push(newSnapshot);

    // Prune old snapshots: Keep only the latest 5 snapshots for this website
    const siteSnapshots = db.snapshots.filter(s => s.websiteId === websiteId);
    if (siteSnapshots.length > 5) {
      siteSnapshots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const toRemoveCount = siteSnapshots.length - 5;
      const idsToRemove = siteSnapshots.slice(0, toRemoveCount).map(s => s.id);
      db.snapshots = db.snapshots.filter(s => !idsToRemove.includes(s.id));
    }

    writeDb(db);
    return newSnapshot;
  },

  // --- LOGS ---
  getLogs(websiteId = null) {
    let logs = readDb().logs;
    if (websiteId) {
      logs = logs.filter(l => l.websiteId === websiteId);
    }
    // Return sorted by timestamp descending
    return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  addLog({ websiteId, changeSummary, diffHtml, diffText, type, details }) {
    const db = readDb();
    const newLog = {
      id: generateId(),
      websiteId,
      timestamp: new Date().toISOString(),
      changeSummary: changeSummary || '',
      diffHtml: diffHtml || '',
      diffText: diffText || '',
      type, // 'change' | 'no_change' | 'error'
      details: details || '',
      isViewed: false
    };
    db.logs.push(newLog);

    // Prune old logs: Keep only the latest 50 logs total to prevent file bloating
    if (db.logs.length > 100) {
      db.logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      db.logs = db.logs.slice(db.logs.length - 100);
    }

    writeDb(db);
    return newLog;
  },

  markLogsAsViewed(websiteId) {
    const db = readDb();
    let updated = false;
    db.logs = db.logs.map(log => {
      if (log.websiteId === websiteId && !log.isViewed) {
        updated = true;
        return { ...log, isViewed: true };
      }
      return log;
    });
    if (updated) {
      writeDb(db);
    }
    return true;
  }
};

module.exports = Database;
