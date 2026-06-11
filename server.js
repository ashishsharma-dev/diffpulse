const express = require('express');
const path = require('path');
const Database = require('./database');
const Scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB and start Scheduler
Database.init();
Scheduler.start();

// --- REST API ENDPOINTS ---

// Get all monitored websites
app.get('/api/websites', (req, res) => {
  try {
    const websites = Database.getWebsites();
    res.json(websites);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a new website
app.post('/api/websites', (req, res) => {
  const { name, url, selector, intervalMinutes, whatsappNumber } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  try {
    const website = Database.addWebsite({ name, url, selector, intervalMinutes, whatsappNumber });
    // Run an initial check in the background so the user gets immediate feedback
    Scheduler.forceCheck(website.id).catch(err => console.error('Initial check failed:', err.message));
    res.status(201).json(website);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a website
app.put('/api/websites/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const updated = Database.updateWebsite(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Website not found' });
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a website
app.delete('/api/websites/:id', (req, res) => {
  const { id } = req.params;
  try {
    const success = Database.deleteWebsite(id);
    if (!success) {
      return res.status(404).json({ error: 'Website not found' });
    }
    res.json({ message: 'Website deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Force check a website
app.post('/api/websites/:id/check', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await Scheduler.forceCheck(id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark logs for a website as viewed
app.post('/api/websites/:id/view', (req, res) => {
  const { id } = req.params;
  try {
    Database.markLogsAsViewed(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test WhatsApp notification general endpoint
app.post('/api/test-whatsapp', async (req, res) => {
  const { whatsappNumber, name } = req.body;
  if (!whatsappNumber || whatsappNumber.trim() === '') {
    return res.status(400).json({ error: 'WhatsApp number is required' });
  }
  try {
    await Scheduler.sendWhatsAppNotification(
      whatsappNumber,
      name || 'Test Monitor',
      'This is a test notification from DiffPulse! Your WhatsApp integration is working perfectly.'
    );
    res.json({ success: true, message: 'Test message sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test WhatsApp notification for an existing website
app.post('/api/websites/:id/test-whatsapp', async (req, res) => {
  const { id } = req.params;
  try {
    const website = Database.getWebsite(id);
    if (!website) {
      return res.status(404).json({ error: 'Website not found' });
    }
    if (!website.whatsappNumber || website.whatsappNumber.trim() === '') {
      return res.status(400).json({ error: 'WhatsApp number is not configured for this website' });
    }
    await Scheduler.sendWhatsAppNotification(
      website.whatsappNumber,
      website.name,
      'This is a test notification from DiffPulse! Your WhatsApp integration is working perfectly.'
    );
    res.json({ success: true, message: 'Test message sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get logs for a specific website
app.get('/api/websites/:id/logs', (req, res) => {
  const { id } = req.params;
  try {
    const logs = Database.getLogs(id);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all logs (for global feed)
app.get('/api/logs', (req, res) => {
  try {
    const logs = Database.getLogs();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`  WEBSITE DIFF DETECTOR ACTIVE ON PORT ${PORT}      `);
  console.log(`  Open your browser: http://localhost:${PORT}      `);
  console.log(`===================================================`);
});
