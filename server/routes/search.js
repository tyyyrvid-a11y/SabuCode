const express = require('express');
const { searchDuckDuckGo } = require('../lib/search');

const router = express.Router();

router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }
  try {
    const results = await searchDuckDuckGo(q, { limit: 10 });
    res.json({ query: q, results });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Search failed' });
  }
});

module.exports = router;
