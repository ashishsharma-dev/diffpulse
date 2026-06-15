const axios = require('axios');
const cheerio = require('cheerio');
const diff = require('diff');
const notifier = require('node-notifier');
const Database = require('./database');

// Simple HTML escaping helper
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Normalize HTML to filter dynamic parameters, csrf tokens, asset query-strings,
// and order classes and attributes for a stable comparison shell.
function extractCleanText(html, selector) {
  const $ = cheerio.load(html);
  
  // Select scope
  let scope = $('html');
  if (selector && selector.trim() !== '') {
    const selected = $(selector);
    if (selected.length > 0) {
      scope = selected;
    }
  }

  // 1. Remove elements that cause high dynamic noise
  scope.find('script, style, iframe, noscript, svg').remove();

  // 2. Remove standard Shopify/dynamic widgets to minimize false positives
  scope.find('[class*="recommendation"], [id*="recommendation"]').remove();
  scope.find('[class*="recently-viewed"], [id*="recently-viewed"]').remove();
  scope.find('[class*="cart-count"], [id*="cart-count"]').remove();
  scope.find('[class*="visitor-count"], [id*="visitor-count"]').remove();
  scope.find('[class*="review-count"], [id*="review-count"]').remove();
  scope.find('[class*="cookie"], [id*="cookie"]').remove();
  scope.find('[class*="popup"], [id*="popup"]').remove();
  scope.find('[class*="dialog"], [id*="dialog"]').remove();

  // 3. Clean and normalize DOM attributes
  scope.find('*').each((i, el) => {
    const $el = $(el);

    // Remove dynamic/sensitive attributes
    $el.removeAttr('nonce');
    $el.removeAttr('csrf-token');
    $el.removeAttr('csrf-param');
    $el.removeAttr('session-id');
    $el.removeAttr('data-csrf');
    $el.removeAttr('data-token');

    // Clean generated/dynamic IDs (e.g. shopify-section-template--12345...)
    const id = $el.attr('id');
    if (id) {
      if (id.includes('shopify-section') || /-\d+$/.test(id) || /^[a-zA-Z0-9]{8,12}$/.test(id)) {
        $el.removeAttr('id');
      }
    }

    // Clean query strings from src and href attributes (asset cache-busters)
    ['src', 'href', 'srcset', 'data-src', 'data-srcset'].forEach(attr => {
      const val = $el.attr(attr);
      if (val) {
        const cleaned = val.split('?')[0];
        $el.attr(attr, cleaned);
      }
    });

    // Normalize class ordering
    const classVal = $el.attr('class');
    if (classVal) {
      const classes = classVal.split(/\s+/).filter(c => c.trim() !== '').sort();
      if (classes.length > 0) {
        $el.attr('class', classes.join(' '));
      } else {
        $el.removeAttr('class');
      }
    }

    // Normalize attribute ordering
    const attribs = el.attribs;
    if (attribs) {
      const sortedKeys = Object.keys(attribs).sort();
      const newAttribs = {};
      sortedKeys.forEach(key => {
        newAttribs[key] = attribs[key];
      });
      el.attribs = newAttribs;
    }
  });

  // Get raw HTML content of the selection
  const rawHtml = scope.html() || '';
  
  // Clean line-by-line for clear code diffing
  const lines = rawHtml
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  return lines.join('\n');
}

// Classify HTML diffs and compute Shopify changes
function analyzeHtmlDiff(diffLinesArray) {
  const changes = [];
  
  // Track consecutive additions/deletions to identify change signatures
  diffLinesArray.forEach(part => {
    if (part.added || part.removed) {
      const value = part.value.trim();
      if (!value) return;

      let type = 'VISUAL';
      let severity = 'LOW';
      let desc = '';

      const isPrice = value.includes('price') || value.includes('compare-at') || /[\$₹€£]/.test(value);
      const isTheme = value.includes('theme') || value.includes('Shopify.theme') || value.includes('shopify-section');
      const isNav = value.includes('nav') || value.includes('menu') || value.includes('header') || value.includes('footer') || value.includes('href');
      const isHeading = /<h[1-6]/.test(value) || value.includes('heading');
      const isApp = value.includes('app') || value.includes('widget') || value.includes('review') || value.includes('wishlist') || value.includes('upsell');

      if (isTheme) {
        type = 'THEME';
        severity = 'HIGH';
        desc = 'Theme layout elements or section settings updated.';
      } else if (isPrice) {
        type = 'PRODUCT';
        severity = 'HIGH';
        const priceMatch = value.match(/[\$₹€£]\s*\d+([.,]\d+)?/g);
        if (priceMatch && priceMatch.length >= 1) {
          desc = `Product price updated (detected: ${priceMatch.join(', ')}).`;
        } else {
          desc = 'Product price or variant pricing information modified.';
        }
      } else if (isNav) {
        type = 'NAVIGATION';
        severity = 'MEDIUM';
        desc = 'Menu item, anchor URL link, or navigation bar updated.';
      } else if (isHeading) {
        type = 'CONTENT';
        severity = 'MEDIUM';
        desc = 'Primary content copy or heading text changed.';
      } else if (isApp) {
        type = 'APP';
        severity = 'LOW';
        desc = 'Third-party app container or marketing widget modified.';
      } else {
        type = 'CONTENT';
        severity = 'LOW';
        desc = 'Cosmetic design tag adjustments or minor text elements modified.';
      }

      // De-duplicate descriptions to keep list clean
      const exists = changes.find(c => c.type === type && c.description === desc);
      if (!exists) {
        changes.push({ type, severity, description: desc });
      }
    }
  });

  // Calculate highest severity
  let overallSeverity = 'NONE';
  if (changes.some(c => c.severity === 'HIGH')) {
    overallSeverity = 'HIGH';
  } else if (changes.some(c => c.severity === 'MEDIUM')) {
    overallSeverity = 'MEDIUM';
  } else if (changes.some(c => c.severity === 'LOW')) {
    overallSeverity = 'LOW';
  }

  // Construct summary list
  const summary = [];
  changes.forEach(c => {
    const item = `${c.type}: ${c.description}`;
    if (!summary.includes(item)) {
      summary.push(item);
    }
  });

  if (summary.length === 0) {
    summary.push("No meaningful Shopify changes detected");
  }

  return {
    changed: changes.length > 0,
    severity: overallSeverity,
    summary: summary.slice(0, 5),
    changes
  };
}

// Send message to WhatsApp via whatstar.co.in API
async function sendWhatsAppNotification(to, siteName, summaryText) {
  if (!to || to.trim() === '') return;

  // Split by comma, semicolon, or space
  const numbers = to.split(/[\s,;]+/).map(n => n.trim()).filter(n => n.length > 0);
  if (numbers.length === 0) return;

  const errors = [];
  const message = `📢 DiffPulse Alert: *${siteName}* has changed!\n\n📋 Summary of changes:\n${summaryText}\n\nCheck dashboard: http://localhost:3000`;

  for (const number of numbers) {
    try {
      const response = await axios.post('https://whatstar.co.in/api/whatsapp-web/send-message', {
        app_key: 'f6661ecb-094d-4f52-a4b6-d59f8b871bc9',
        auth_key: 'vthAQkMncDLxnEmiU3QoPtRfUlBrpvCu2',
        to: number,
        type: 'text',
        message: message
      }, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      console.log(`WhatsApp notification sent successfully to ${number}. Response status:`, response.status);
    } catch (error) {
      const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
      console.error(`Error sending WhatsApp notification to ${number}:`, errMsg);
      errors.push({ number, error: errMsg });
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to send WhatsApp message to: ${errors.map(e => `${e.number} (${e.error})`).join(', ')}`);
  }
}

// Perform a check for a specific website
async function checkWebsite(website) {
  console.log(`Checking website: ${website.name} (${website.url})`);
  const nowStr = new Date().toISOString();

  try {
    const response = await axios.get(website.url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    const rawHtml = response.data;
    const statusCode = response.status;
    const cleanText = extractCleanText(rawHtml, website.selector);

    const prevSnapshot = Database.getLatestSnapshot(website.id);

    if (!prevSnapshot) {
      // First scan: Save snapshot and log initial check
      Database.addSnapshot({
        websiteId: website.id,
        rawHtml,
        text: cleanText,
        statusCode
      });

      Database.updateWebsite(website.id, {
        lastChecked: nowStr,
        lastChanged: nowStr
      });

      Database.addLog({
        websiteId: website.id,
        changeSummary: 'Initial snapshot stored',
        diffHtml: '<div style="color: var(--text-muted);">First snapshot created. Monitoring active.</div>',
        diffText: 'First snapshot created. Monitoring active.',
        type: 'change'
      });

      console.log(`Initial snapshot saved for ${website.name}`);
      return { status: 'initial', changes: false };
    }

    // Compare HTML line by line
    const textDiff = diff.diffLines(prevSnapshot.text, cleanText);
    let addedLines = 0;
    let removedLines = 0;
    let hasChanges = false;
    let diffHtml = '';
    let diffTextArr = [];

    const allLines = [];

    // Flatten all lines from diff parts
    textDiff.forEach(part => {
      const isChanged = part.added || part.removed;
      if (isChanged) {
        hasChanges = true;
        if (part.added) addedLines += part.count || 1;
        if (part.removed) removedLines += part.count || 1;
      }

      const lines = part.value.split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') {
        lines.pop();
      }

      lines.forEach(line => {
        allLines.push({
          text: line,
          added: !!part.added,
          removed: !!part.removed,
          visible: false
        });
      });
    });

    // Mark lines visible if they are part of a change or within 3 lines of context
    const CONTEXT_SIZE = 3;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].added || allLines[i].removed) {
        allLines[i].visible = true;
        // Mark context before
        for (let j = Math.max(0, i - CONTEXT_SIZE); j < i; j++) {
          allLines[j].visible = true;
        }
        // Mark context after
        for (let j = i + 1; j < Math.min(allLines.length, i + CONTEXT_SIZE + 1); j++) {
          allLines[j].visible = true;
        }
      }
    }

    // Render lines with collapse indicators for skipped blocks
    let skippedCount = 0;
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      if (line.visible) {
        if (skippedCount > 0) {
          diffHtml += `<div class="diff-line diff-unchanged" style="opacity: 0.4;"><span class="diff-prefix">...</span><span class="diff-content" style="color: var(--text-dark); font-style: italic;">... skipped ${skippedCount} unchanged lines ...</span></div>`;
          skippedCount = 0;
        }

        const className = line.added ? 'diff-added' : (line.removed ? 'diff-removed' : 'diff-unchanged');
        const prefix = line.added ? '+' : (line.removed ? '-' : ' ');
        const escaped = escapeHtml(line.text);

        diffHtml += `<div class="diff-line ${className}"><span class="diff-prefix">${prefix}</span><span class="diff-content">${escaped}</span></div>`;
        diffTextArr.push(`${prefix} ${line.text}`);
      } else {
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      diffHtml += `<div class="diff-line diff-unchanged" style="opacity: 0.4;"><span class="diff-prefix">...</span><span class="diff-content" style="color: var(--text-dark); font-style: italic;">... skipped ${skippedCount} unchanged lines ...</span></div>`;
    }

    if (hasChanges) {
      // Analyze HTML changes for structured report
      const report = analyzeHtmlDiff(textDiff);
      const summaryText = report.summary.join(', ');
      
      // Save snapshot
      Database.addSnapshot({
        websiteId: website.id,
        rawHtml,
        text: cleanText,
        statusCode
      });

      // Update website timestamps
      Database.updateWebsite(website.id, {
        lastChecked: nowStr,
        lastChanged: nowStr
      });

      // Write log with JSON details
      Database.addLog({
        websiteId: website.id,
        changeSummary: summaryText,
        diffHtml,
        diffText: diffTextArr.join('\n'),
        type: 'change',
        details: JSON.stringify(report)
      });

      // Trigger OS Notification
      notifier.notify({
        title: `Website Changed: ${website.name}`,
        message: `Changes detected: ${summaryText}`,
        sound: true,
        wait: false
      });

      // Send WhatsApp Notification if number is set
      if (website.whatsappNumber && website.whatsappNumber.trim() !== '') {
        sendWhatsAppNotification(website.whatsappNumber, website.name, summaryText)
          .catch(err => console.error('Failed to send WhatsApp message:', err.message));
      }

      console.log(`Changes detected for ${website.name}: ${summaryText}`);
      return { status: 'changed', summary: summaryText, changes: true };
    } else {
      // No changes: Just update lastChecked
      Database.updateWebsite(website.id, {
        lastChecked: nowStr
      });
      console.log(`No changes for ${website.name}`);
      return { status: 'no_change', changes: false };
    }

  } catch (error) {
    console.error(`Error checking website ${website.name}:`, error.message);
    
    Database.updateWebsite(website.id, {
      lastChecked: nowStr
    });

    Database.addLog({
      websiteId: website.id,
      changeSummary: 'Error checking website',
      diffHtml: `<div class="diff-line diff-error"><span class="diff-prefix">!</span><span class="diff-content">${escapeHtml(error.message)}</span></div>`,
      diffText: `Error: ${error.message}`,
      type: 'error',
      details: error.message
    });

    return { status: 'error', error: error.message, changes: false };
  }
}

let checkIntervalId = null;

const Scheduler = {
  // Start the scheduling ticks
  start() {
    if (checkIntervalId) return;

    console.log('Scheduler started. Checking for due websites every 15 seconds...');
    
    // Check every 15 seconds for any due websites
    checkIntervalId = setInterval(async () => {
      const websites = Database.getWebsites();
      const activeWebsites = websites.filter(w => w.isActive);
      const now = new Date();

      for (const website of activeWebsites) {
        let isDue = false;
        
        if (!website.lastChecked) {
          isDue = true;
        } else {
          const lastCheckedTime = new Date(website.lastChecked);
          const elapsedMs = now - lastCheckedTime;
          const intervalMs = website.intervalMinutes * 60 * 1000;
          if (elapsedMs >= intervalMs) {
            isDue = true;
          }
        }

        if (isDue) {
          // Check sequentially to avoid hammering network resources
          await checkWebsite(website);
        }
      }
    }, 15000);
  },

  stop() {
    if (checkIntervalId) {
      clearInterval(checkIntervalId);
      checkIntervalId = null;
      console.log('Scheduler stopped.');
    }
  },

  // Expose checkWebsite for manual triggers
  async forceCheck(id) {
    const website = Database.getWebsite(id);
    if (!website) throw new Error('Website not found');
    return await checkWebsite(website);
  },

  // Expose WhatsApp sending utility
  async sendWhatsAppNotification(to, siteName, summaryText) {
    return await sendWhatsAppNotification(to, siteName, summaryText);
  }
};

module.exports = Scheduler;
