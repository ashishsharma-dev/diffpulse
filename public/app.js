// Application State
let state = {
  websites: [],
  logs: [],
  activeWebsiteId: null,
  activeLogId: null,
  activeTab: 'tab-history', // tab-history | tab-config
  activeView: 'dashboard' // dashboard | activity
};

// Relative Time Formatter
function formatRelativeTime(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// Full Date Formatter
function formatFullDate(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Initialize Lucide Icons
function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// --- DOM ELEMENTS ---
const el = {
  // Navigation
  navDashboard: document.getElementById('nav-dashboard'),
  navActivity: document.getElementById('nav-activity'),
  viewDashboard: document.getElementById('view-dashboard'),
  viewActivity: document.getElementById('view-activity'),
  
  // Sidebar Stats
  statMonitored: document.getElementById('stat-monitored-count'),
  statActive: document.getElementById('stat-active-count'),
  statLastTick: document.getElementById('stat-last-tick'),
  
  // Dashboard view
  websitesGrid: document.getElementById('websites-grid'),
  badgeWebsites: document.getElementById('website-count-badge'),
  btnAddSite: document.getElementById('btn-add-site'),
  
  // Activity view
  activityTimeline: document.getElementById('activity-timeline'),
  
  // Add Site Modal
  modalOverlay: document.getElementById('modal-overlay'),
  modalClose: document.getElementById('btn-close-modal'),
  modalCancel: document.getElementById('btn-cancel-modal'),
  addSiteForm: document.getElementById('add-site-form'),
  
  // Drawer
  drawer: document.getElementById('details-drawer'),
  drawerOverlay: document.getElementById('drawer-overlay'),
  drawerClose: document.getElementById('btn-close-drawer'),
  drawerSiteName: document.getElementById('drawer-site-name'),
  drawerSiteLink: document.getElementById('drawer-site-link'),
  drawerSiteUrl: document.getElementById('drawer-site-url'),
  drawerHistoryList: document.getElementById('drawer-history-list'),
  drawerTabs: document.querySelectorAll('.tab-btn'),
  drawerTabContents: document.querySelectorAll('.tab-content'),
  
  // Diff View
  selectedDiffType: document.getElementById('selected-diff-type'),
  selectedDiffTime: document.getElementById('selected-diff-time'),
  selectedDiffSummary: document.getElementById('selected-diff-summary'),
  selectedDiffContainer: document.getElementById('selected-diff-container'),
  
  // Settings Form
  editSiteForm: document.getElementById('edit-site-form'),
  editSiteId: document.getElementById('edit-site-id'),
  editSiteName: document.getElementById('edit-site-name-input'),
  editSiteUrl: document.getElementById('edit-site-url-input'),
  editSiteInterval: document.getElementById('edit-site-interval'),
  editSiteSelector: document.getElementById('edit-site-selector'),
  btnDeleteSite: document.getElementById('btn-delete-site')
};

// --- DATA FETCHING & API SERVICES ---

async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error(`API Fetch Error (${url}):`, error.message);
    throw error;
  }
}

// Load websites and activity logs
async function loadData() {
  try {
    const [websites, logs] = await Promise.all([
      apiFetch('/api/websites'),
      apiFetch('/api/logs')
    ]);
    
    state.websites = websites;
    state.logs = logs;
    
    renderStats();
    
    if (state.activeView === 'dashboard') {
      renderWebsites();
    } else {
      renderActivityLogs();
    }
  } catch (error) {
    console.error('Failed to load data:', error.message);
  }
}

// --- RENDERING ---

function renderStats() {
  el.statMonitored.innerText = state.websites.length;
  el.statActive.innerText = state.websites.filter(w => w.isActive).length;
  el.badgeWebsites.innerText = `${state.websites.length} Sites`;

  // Determine last tick (latest checked time from all sites)
  const checkedTimes = state.websites
    .map(w => w.lastChecked)
    .filter(t => t !== null)
    .map(t => new Date(t));
  
  if (checkedTimes.length > 0) {
    const newest = new Date(Math.max(...checkedTimes));
    el.statLastTick.innerText = formatRelativeTime(newest.toISOString());
  } else {
    el.statLastTick.innerText = 'Never';
  }

  // Render global unviewed changes badges
  const totalUnviewed = state.logs.filter(l => !l.isViewed && l.type !== 'no_change').length;
  
  const navDashBadge = el.navDashboard.querySelector('.unviewed-badge');
  if (navDashBadge) navDashBadge.remove();
  if (totalUnviewed > 0) {
    el.navDashboard.insertAdjacentHTML('beforeend', `<span class="unviewed-badge">${totalUnviewed}</span>`);
  }

  const navActBadge = el.navActivity.querySelector('.unviewed-badge');
  if (navActBadge) navActBadge.remove();
  if (totalUnviewed > 0) {
    el.navActivity.insertAdjacentHTML('beforeend', `<span class="unviewed-badge">${totalUnviewed}</span>`);
  }
}

function renderWebsites() {
  if (state.websites.length === 0) {
    el.websitesGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="monitor-play"></i>
        <h3>No websites monitored yet</h3>
        <p>Start monitoring a site to track its changes over time.</p>
        <button class="btn btn-primary btn-sm" onclick="openAddSiteModal()">
          <i data-lucide="plus"></i>
          <span>Add Website</span>
        </button>
      </div>
    `;
    initIcons();
    return;
  }

  el.websitesGrid.innerHTML = state.websites.map(site => {
    // Determine card status dot class
    // Find latest log for this site to check for error
    const siteLogs = state.logs.filter(l => l.websiteId === site.id);
    const latestLog = siteLogs[0];
    const unviewedCount = siteLogs.filter(l => !l.isViewed && l.type !== 'no_change').length;
    
    let statusClass = 'success';
    let statusLabel = 'Healthy';
    
    if (latestLog && latestLog.type === 'error') {
      statusClass = 'error';
      statusLabel = 'Connection Error';
    } else if (!site.lastChecked) {
      statusClass = 'warning';
      statusLabel = 'Pending Sync';
    } else if (!site.isActive) {
      statusClass = 'warning';
      statusLabel = 'Paused';
    }

    return `
      <div class="site-card" data-id="${site.id}">
        <div class="site-card-header">
          <div class="site-card-title-area">
            <span class="site-card-name">${escapeHtml(site.name)}</span>
            <span class="site-card-url">${escapeHtml(site.url)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${unviewedCount > 0 ? `<span class="unviewed-badge">${unviewedCount}</span>` : ''}
            <span class="health-dot ${statusClass}" title="${statusLabel}"></span>
          </div>
        </div>
        <div class="site-card-stats">
          <div class="card-stat-row">
            <span>Selector:</span>
            <span class="card-stat-val">${site.selector ? `<code>${escapeHtml(site.selector)}</code>` : 'Entire Body'}</span>
          </div>
          <div class="card-stat-row">
            <span>Interval:</span>
            <span class="card-stat-val">${site.intervalMinutes} mins</span>
          </div>
          <div class="card-stat-row">
            <span>Alerts:</span>
            <span class="card-stat-val">${site.whatsappNumber ? `WhatsApp (${escapeHtml(site.whatsappNumber)})` : 'Desktop Toast'}</span>
          </div>
          <div class="card-stat-row">
            <span>Checked:</span>
            <span class="card-stat-val">${formatRelativeTime(site.lastChecked)}</span>
          </div>
          <div class="card-stat-row">
            <span>Changed:</span>
            <span class="card-stat-val">${formatRelativeTime(site.lastChanged)}</span>
          </div>
        </div>
        <div class="site-card-actions">
          <label class="switch" title="Toggle active tracking" onclick="event.stopPropagation()">
            <input type="checkbox" ${site.isActive ? 'checked' : ''} onchange="toggleSiteActive('${site.id}', this.checked)">
            <span class="slider"></span>
          </label>
          <div class="card-btns">
            <button class="icon-btn btn-check-now" title="Check for changes now" onclick="forceCheckSite(event, '${site.id}')">
              <i data-lucide="refresh-cw"></i>
            </button>
            <button class="icon-btn" title="Delete monitor" onclick="deleteSiteFromCard(event, '${site.id}')" style="color: rgba(239, 68, 68, 0.85);">
              <i data-lucide="trash-2"></i>
            </button>
            <button class="icon-btn" title="Inspect versions & configurations">
              <i data-lucide="chevron-right"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach click listener to each card to open details drawer
  document.querySelectorAll('.site-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      openDrawer(id);
    });
  });

  initIcons();
}

function renderActivityLogs() {
  if (state.logs.length === 0) {
    el.activityTimeline.innerHTML = `
      <div class="empty-state">
        <i data-lucide="activity"></i>
        <h3>No activity logged yet</h3>
        <p>Logs will automatically generate when websites are checked or modified.</p>
      </div>
    `;
    initIcons();
    return;
  }

  el.activityTimeline.innerHTML = state.logs.map(log => {
    const site = state.websites.find(w => w.id === log.websiteId);
    const siteName = site ? site.name : 'Deleted Website';
    
    let icon = 'git-commit';
    let iconClass = 'change';
    
    if (log.type === 'error') {
      icon = 'alert-triangle';
      iconClass = 'error';
    } else if (log.changeSummary.includes('Initial snapshot')) {
      icon = 'check-square';
      iconClass = 'initial';
    }

    return `
      <div class="activity-card" style="cursor: ${site ? 'pointer' : 'default'}" onclick="${site ? `openDrawer('${site.id}')` : ''}">
        <div class="activity-icon-container ${iconClass}">
          <i data-lucide="${icon}"></i>
        </div>
        <div class="activity-content">
          <div class="activity-header-line">
            <span class="activity-site-name">${escapeHtml(siteName)}</span>
            <span class="activity-time">${formatRelativeTime(log.timestamp)}</span>
          </div>
          <p class="activity-desc">${escapeHtml(log.changeSummary)}</p>
        </div>
      </div>
    `;
  }).join('');

  initIcons();
}

// --- DETAILS DRAWER & DIFF LOGIC ---

async function openDrawer(websiteId) {
  state.activeWebsiteId = websiteId;
  const site = state.websites.find(w => w.id === websiteId);
  if (!site) return;

  // Mark all changes as viewed on the backend
  try {
    await apiFetch(`/api/websites/${websiteId}/view`, { method: 'POST' });
    loadData(); // Trigger UI reload to update badges immediately
  } catch (err) {
    console.error('Failed to mark logs as viewed:', err.message);
  }

  // Set header details
  el.drawerSiteName.innerText = site.name;
  el.drawerSiteUrl.innerText = site.url;
  el.drawerSiteLink.href = site.url;

  // Set edit form values
  el.editSiteId.value = site.id;
  el.editSiteName.value = site.name;
  el.editSiteUrl.value = site.url;
  el.editSiteInterval.value = site.intervalMinutes;
  el.editSiteSelector.value = site.selector || '';
  document.getElementById('edit-site-whatsapp').value = site.whatsappNumber || '';

  // Show active tab contents
  switchTab(state.activeTab);

  // Load site logs for the sidebar
  await loadSiteLogsList(websiteId);

  // Add active classes
  el.drawerOverlay.classList.add('active');
  el.drawer.classList.add('active');
}

function closeDrawer() {
  el.drawerOverlay.classList.remove('active');
  el.drawer.classList.remove('active');
  state.activeWebsiteId = null;
  state.activeLogId = null;
}

function switchTab(tabId) {
  state.activeTab = tabId;
  el.drawerTabs.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  el.drawerTabContents.forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
}

async function loadSiteLogsList(websiteId) {
  try {
    const logs = await apiFetch(`/api/websites/${websiteId}/logs`);
    renderDrawerHistory(logs);
    
    // Auto select first log if available
    if (logs.length > 0) {
      selectLog(logs[0]);
    } else {
      renderEmptyDiff();
    }
  } catch (error) {
    console.error('Failed to load site logs:', error.message);
  }
}

function renderDrawerHistory(logs) {
  if (logs.length === 0) {
    el.drawerHistoryList.innerHTML = `<div style="padding: 20px; color: var(--text-dark); text-align: center; font-size: 13px;">No history records found.</div>`;
    return;
  }

  el.drawerHistoryList.innerHTML = logs.map((log, index) => {
    let typeClass = '';
    let icon = 'edit-3';
    
    if (log.type === 'error') {
      typeClass = 'error';
      icon = 'alert-triangle';
    } else if (log.changeSummary.includes('Initial snapshot')) {
      typeClass = 'initial';
      icon = 'check-square';
    }

    const isActive = state.activeLogId === log.id || (!state.activeLogId && index === 0);
    if (isActive) state.activeLogId = log.id;

    return `
      <div class="history-item ${typeClass} ${isActive ? 'active' : ''}" data-log-id="${log.id}">
        <span class="history-item-time">${formatRelativeTime(log.timestamp)}</span>
        <span class="history-item-summary">
          <i data-lucide="${icon}" style="width: 10px; height: 10px;"></i>
          ${escapeHtml(log.changeSummary)}
        </span>
      </div>
    `;
  }).join('');

  // Click handler to select log
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const logId = item.getAttribute('data-log-id');
      // Find log in global list or fetch if missing (should be in state.logs or we query)
      const logsForSite = state.logs.length > 0 ? state.logs : [];
      let log = logsForSite.find(l => l.id === logId);
      
      // If we can't find it in cached state.logs, we can fetch
      if (!log) {
        // Fallback: check elements
        // Let's query state.logs or API
        apiFetch(`/api/logs`).then(allLogs => {
          state.logs = allLogs;
          const found = allLogs.find(l => l.id === logId);
          if (found) selectLog(found);
        });
      } else {
        selectLog(log);
      }

      // Highlight selected item
      document.querySelectorAll('.history-item').forEach(hi => hi.classList.remove('active'));
      item.classList.add('active');
    });
  });

  initIcons();
}

function selectLog(log) {
  state.activeLogId = log.id;
  
  // Set meta details
  el.selectedDiffTime.innerText = formatFullDate(log.timestamp);
  el.selectedDiffSummary.innerText = log.changeSummary;
  
  // Diff type badge style
  el.selectedDiffType.innerText = log.type === 'change' ? 'Change' : (log.type === 'initial' || log.changeSummary.includes('Initial') ? 'Initial' : 'Error');
  el.selectedDiffType.className = 'diff-type-badge';
  el.selectedDiffType.classList.add(log.type === 'error' ? 'error' : (log.changeSummary.includes('Initial') ? 'initial' : 'change'));

  // Attempt to parse structured change report details
  let report = null;
  if (log.details) {
    try {
      report = JSON.parse(log.details);
    } catch(e) {
      report = null;
    }
  }

  // Render diff container HTML
  if (report && report.changed) {
    let severityColor = 'var(--success)';
    if (report.severity === 'HIGH') severityColor = 'var(--error)';
    else if (report.severity === 'MEDIUM') severityColor = 'var(--warning)';

    let changesHtml = report.changes.map(c => `
      <div style="background: rgba(255,255,255,0.015); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 12px 16px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span class="badge" style="background: var(--bg-tertiary); color: var(--accent-secondary); border-color: rgba(6, 182, 212, 0.2); font-size: 10px;">${escapeHtml(c.type)}</span>
          <span style="font-size: 10px; font-weight: 700; color: ${c.severity === 'HIGH' ? 'var(--error)' : (c.severity === 'MEDIUM' ? 'var(--warning)' : 'var(--text-muted)')}">${c.severity}</span>
        </div>
        <p style="font-size: 13px; color: var(--text-main); line-height: 1.4; font-family: sans-serif;">${escapeHtml(c.description)}</p>
      </div>
    `).join('');

    el.selectedDiffContainer.innerHTML = `
      <div class="shopify-report-card" style="padding: 20px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: var(--border-radius-lg); backdrop-filter: blur(10px); margin-bottom: 20px;">
        <h4 style="font-family: 'Outfit', sans-serif; font-size: 15px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <i data-lucide="shield-alert" style="width: 16px; height: 16px; color: ${severityColor}"></i>
          Change Detection Audit
        </h4>
        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <span class="diff-type-badge" style="background: ${report.severity === 'HIGH' ? 'rgba(239, 68, 68, 0.1)' : (report.severity === 'MEDIUM' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)')}; color: ${severityColor}; border: 1px solid ${severityColor}20;">Severity: ${report.severity}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px;">
          ${report.summary.map(s => `<div style="font-size: 13px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; font-family: sans-serif;"><span style="width: 6px; height: 6px; border-radius: 50%; background: ${severityColor}; display: inline-block; flex-shrink: 0;"></span>${escapeHtml(s)}</div>`).join('')}
        </div>
        
        <h5 style="font-size: 11px; font-weight: 700; color: var(--text-dark); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Change Log</h5>
        <div class="report-changes-list">
          ${changesHtml}
        </div>
      </div>
      
      <details style="margin-top: 15px;">
        <summary style="font-size: 13px; font-weight: 600; color: var(--accent-secondary); cursor: pointer; user-select: none; padding: 5px 0;">View Raw Code Diff</summary>
        <div class="diff-viewer" style="margin-top: 10px;">${log.diffHtml}</div>
      </details>
    `;
    initIcons();
  } else if (log.diffHtml) {
    el.selectedDiffContainer.innerHTML = `<div class="diff-viewer">${log.diffHtml}</div>`;
  } else if (log.type === 'error') {
    el.selectedDiffContainer.innerHTML = `
      <div class="diff-viewer">
        <div class="diff-line diff-error">
          <span class="diff-prefix">!</span>
          <span class="diff-content">Failed to fetch website. Reason: ${escapeHtml(log.details || 'Unknown connection error')}</span>
        </div>
      </div>
    `;
  } else {
    el.selectedDiffContainer.innerHTML = `
      <div class="diff-viewer">
        <div class="diff-line diff-unchanged">
          <span class="diff-prefix"> </span>
          <span class="diff-content">No differences recorded.</span>
        </div>
      </div>
    `;
  }
}

function renderEmptyDiff() {
  el.selectedDiffTime.innerText = '';
  el.selectedDiffSummary.innerText = 'No scan history';
  el.selectedDiffContainer.innerHTML = `
    <div class="diff-empty-state">
      <i data-lucide="info"></i>
      <p>This website has no history snapshots stored yet.</p>
    </div>
  `;
  initIcons();
}

// --- UI INTERACTIONS & EVENT LISTENERS ---

function openAddSiteModal() {
  el.modalOverlay.classList.add('active');
}

function closeAddSiteModal() {
  el.modalOverlay.classList.remove('active');
  el.addSiteForm.reset();
}

// Manual trigger website check
async function forceCheckSite(event, websiteId) {
  event.stopPropagation();
  
  // Find card button to rotate
  const card = document.querySelector(`.site-card[data-id="${websiteId}"]`);
  const btn = card ? card.querySelector('.btn-check-now') : null;
  if (btn) btn.classList.add('spinning');

  try {
    const result = await apiFetch(`/api/websites/${websiteId}/check`, { method: 'POST' });
    console.log('Force check result:', result);
    // Reload database data
    await loadData();
    // If drawer is open and looking at this site, update history list
    if (state.activeWebsiteId === websiteId) {
      await loadSiteLogsList(websiteId);
    }
  } catch (err) {
    alert(`Failed to check website: ${err.message}`);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

// Toggle tracking status
async function toggleSiteActive(websiteId, isActive) {
  try {
    await apiFetch(`/api/websites/${websiteId}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive })
    });
    // Reload state
    await loadData();
  } catch (err) {
    alert(`Failed to update tracking state: ${err.message}`);
  }
}

// Quick delete website from card
async function deleteSiteFromCard(event, websiteId) {
  event.stopPropagation();
  if (!confirm('Are you sure you want to delete this website monitor? All snapshot logs will be permanently deleted.')) {
    return;
  }
  try {
    await apiFetch(`/api/websites/${websiteId}`, { method: 'DELETE' });
    await loadData();
  } catch (err) {
    alert(`Failed to delete monitor: ${err.message}`);
  }
}

// Form Submit: Add website
el.addSiteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('add-site-name').value;
  const url = document.getElementById('add-site-url').value;
  const intervalMinutes = parseInt(document.getElementById('add-site-interval').value, 10);
  const selector = document.getElementById('add-site-selector').value;
  const whatsappNumber = document.getElementById('add-site-whatsapp').value;

  try {
    await apiFetch('/api/websites', {
      method: 'POST',
      body: JSON.stringify({ name, url, intervalMinutes, selector, whatsappNumber })
    });
    closeAddSiteModal();
    await loadData();
  } catch (err) {
    alert(`Failed to add website: ${err.message}`);
  }
});

// Form Submit: Edit website
el.editSiteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el.editSiteId.value;
  const name = el.editSiteName.value;
  const url = el.editSiteUrl.value;
  const intervalMinutes = parseInt(el.editSiteInterval.value, 10);
  const selector = el.editSiteSelector.value;
  const whatsappNumber = document.getElementById('edit-site-whatsapp').value;

  try {
    await apiFetch(`/api/websites/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, url, intervalMinutes, selector, whatsappNumber })
    });
    closeDrawer();
    await loadData();
  } catch (err) {
    alert(`Failed to update settings: ${err.message}`);
  }
});

// Delete website
el.btnDeleteSite.addEventListener('click', async () => {
  const id = el.editSiteId.value;
  if (!confirm('Are you sure you want to delete this website monitor? All snapshot logs will be permanently deleted.')) {
    return;
  }
  
  try {
    await apiFetch(`/api/websites/${id}`, { method: 'DELETE' });
    closeDrawer();
    await loadData();
  } catch (err) {
    alert(`Failed to delete monitor: ${err.message}`);
  }
});

// Navigation Switcher
el.navDashboard.addEventListener('click', () => {
  el.navDashboard.classList.add('active');
  el.navActivity.classList.remove('active');
  el.viewDashboard.classList.add('active');
  el.viewActivity.classList.remove('active');
  state.activeView = 'dashboard';
  renderWebsites();
});

el.navActivity.addEventListener('click', () => {
  el.navActivity.classList.add('active');
  el.navDashboard.classList.remove('active');
  el.viewActivity.classList.add('active');
  el.viewDashboard.classList.remove('active');
  state.activeView = 'activity';
  renderActivityLogs();
});

// Modal Events
el.btnAddSite.addEventListener('click', openAddSiteModal);
el.modalClose.addEventListener('click', closeAddSiteModal);
el.modalCancel.addEventListener('click', closeAddSiteModal);
el.modalOverlay.addEventListener('click', (e) => {
  if (e.target === el.modalOverlay) {
    closeAddSiteModal();
  }
});

// Drawer Events
el.drawerClose.addEventListener('click', closeDrawer);
el.drawerOverlay.addEventListener('click', closeDrawer);

el.drawerTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.getAttribute('data-tab');
    switchTab(tabId);
  });
});

// HTML Escaping Helper
function escapeHtml(text) {
  if (!text) return '';
  return text
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  
  // Set up background poll interval (every 10 seconds to keep UI synced)
  setInterval(loadData, 10000);

  // Wire up WhatsApp Test buttons
  const btnAddTestWhatsapp = document.getElementById('btn-add-test-whatsapp');
  if (btnAddTestWhatsapp) {
    btnAddTestWhatsapp.addEventListener('click', async () => {
      const whatsappNumber = document.getElementById('add-site-whatsapp').value;
      const name = document.getElementById('add-site-name').value || 'Test Monitor';
      if (!whatsappNumber || whatsappNumber.trim() === '') {
        alert('Please enter a WhatsApp number first.');
        return;
      }
      
      const originalText = btnAddTestWhatsapp.innerHTML;
      btnAddTestWhatsapp.disabled = true;
      btnAddTestWhatsapp.innerHTML = `<span class="spinner-sm" style="display:inline-block; width:12px; height:12px; border:2px solid var(--text-muted); border-top-color:var(--text-main); border-radius:50%; animation:spin 1s linear infinite; margin-right:4px; vertical-align: middle;"></span> Sending...`;

      try {
        const res = await apiFetch('/api/test-whatsapp', {
          method: 'POST',
          body: JSON.stringify({ whatsappNumber, name })
        });
        alert(res.message || 'Test message sent successfully!');
      } catch (err) {
        alert(`Failed to send test message: ${err.message}`);
      } finally {
        btnAddTestWhatsapp.disabled = false;
        btnAddTestWhatsapp.innerHTML = originalText;
      }
    });
  }

  const btnTestWhatsapp = document.getElementById('btn-test-whatsapp');
  if (btnTestWhatsapp) {
    btnTestWhatsapp.addEventListener('click', async () => {
      const whatsappNumber = document.getElementById('edit-site-whatsapp').value;
      const name = el.editSiteName.value || 'Test Monitor';
      if (!whatsappNumber || whatsappNumber.trim() === '') {
        alert('Please enter a WhatsApp number first.');
        return;
      }

      const originalText = btnTestWhatsapp.innerHTML;
      btnTestWhatsapp.disabled = true;
      btnTestWhatsapp.innerHTML = `<span class="spinner-sm" style="display:inline-block; width:12px; height:12px; border:2px solid var(--text-muted); border-top-color:var(--text-main); border-radius:50%; animation:spin 1s linear infinite; margin-right:4px; vertical-align: middle;"></span> Sending...`;

      try {
        const res = await apiFetch('/api/test-whatsapp', {
          method: 'POST',
          body: JSON.stringify({ whatsappNumber, name })
        });
        alert(res.message || 'Test message sent successfully!');
      } catch (err) {
        alert(`Failed to send test message: ${err.message}`);
      } finally {
        btnTestWhatsapp.disabled = false;
        btnTestWhatsapp.innerHTML = originalText;
      }
    });
  }
});
