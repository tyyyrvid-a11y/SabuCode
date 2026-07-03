require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const chatRoute = require('./routes/chat');
const searchRoute = require('./routes/search');
const exportRoute = require('./routes/export');
const { COMMANDS } = require('./lib/nim');

const app = express();
const PORT = process.env.PORT || 3000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE) || 60;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', limiter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    commands: Object.keys(COMMANDS).concat('agent'),
    configured: Boolean(
      process.env.NVIDIA_NIM_API_KEY &&
        !process.env.NVIDIA_NIM_API_KEY.includes('REPLACE_WITH_YOUR_KEY')
    )
  });
});

// hands the browser the Supabase project URL + anon key so it can talk to Supabase
// directly (anon key is meant to be public; access is governed by RLS policies)
app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const supabaseConfigured =
    Boolean(supabaseUrl && supabaseAnonKey) && !supabaseUrl.includes('REPLACE_WITH_YOUR');
  res.json({
    supabaseUrl: supabaseConfigured ? supabaseUrl : null,
    supabaseAnonKey: supabaseConfigured ? supabaseAnonKey : null
  });
});

app.use('/api/chat', chatRoute);
app.use('/api/search', searchRoute);
app.use('/api/export', exportRoute);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Vercel imports this file as a serverless function (see vercel.json) instead
// of running it directly, so only bind a port for local/traditional hosting.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SabuCode server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
