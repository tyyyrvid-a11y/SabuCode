const express = require('express');
const archiver = require('archiver');

const router = express.Router();

// POST { projectName, files: [{ path, content }] } -> streams a .zip
router.post('/', (req, res) => {
  const { projectName = 'sabucode-project', files } = req.body || {};

  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: 'files must be a non-empty array of { path, content }' });
  }

  const safeName = String(projectName).replace(/[^a-z0-9-_]/gi, '_') || 'sabucode-project';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    res.status(500).end(String(err.message || err));
  });
  archive.pipe(res);

  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
    const cleanPath = file.path.replace(/^[/\\]+/, '').replace(/\.\.(\/|\\)/g, '');
    if (!cleanPath) continue;
    archive.append(file.content, { name: cleanPath });
  }

  archive.finalize();
});

module.exports = router;
