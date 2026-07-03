const Preview = (() => {
  function basename(p) {
    return p.split('/').pop();
  }

  function findFile(files, predicate) {
    for (const [path, content] of files.entries()) {
      if (predicate(path)) return { path, content };
    }
    return null;
  }

  function resolveSibling(files, refPath) {
    if (!refPath || /^(https?:)?\/\//i.test(refPath)) return null; // external, leave alone
    const clean = refPath.split('?')[0].split('#')[0].replace(/^\.?\//, '');
    for (const [path, content] of files.entries()) {
      if (path === clean || path.endsWith('/' + clean) || basename(path) === basename(clean)) {
        return content;
      }
    }
    return null;
  }

  // Inline <link rel=stylesheet href=local.css> and <script src=local.js> so a
  // multi-file HTML/CSS/JS project renders correctly inside a srcdoc iframe (no filesystem).
  function inlineHtml(html, files) {
    let out = html;

    out = out.replace(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href) => {
      const css = resolveSibling(files, href);
      return css ? `<style>\n${css}\n</style>` : match;
    });

    out = out.replace(/<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi, (match, pre, src, post) => {
      const js = resolveSibling(files, src);
      if (!js) return match; // external CDN script, leave as-is
      const attrs = `${pre} ${post}`.replace(/\s+/g, ' ').trim();
      return `<script${attrs ? ' ' + attrs : ''}>\n${js}\n</script>`;
    });

    return out;
  }

  const REACT_CDN = [
    '<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>',
    '<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>',
    '<script crossorigin src="https://unpkg.com/@babel/standalone/babel.min.js"></script>'
  ].join('\n');

  function looksLikeReact(content) {
    return /from\s+['"]react/i.test(content) || /React\.(createElement|useState|Component)/.test(content) || /<\/?[A-Za-z][\s\S]*?>/.test(content) && /export default|function [A-Z]|const [A-Z]\w* =/.test(content);
  }

  function stripModuleSyntax(code) {
    return code
      .replace(/^\s*import\s+.*?;?\s*$/gm, '')
      .replace(/^\s*export\s+default\s+/gm, 'window.__lastExport = ')
      .replace(/^\s*export\s+/gm, '');
  }

  function buildReactHtml(jsFiles) {
    const combined = jsFiles.map(({ content }) => stripModuleSyntax(content)).join('\n\n');
    const hasApp = /\b(function|class|const)\s+App\b/.test(combined);
    const mount = hasApp
      ? `const __root = ReactDOM.createRoot(document.getElementById('root'));\n__root.render(React.createElement(App));`
      : `if (window.__lastExport) { const __root = ReactDOM.createRoot(document.getElementById('root')); __root.render(React.createElement(window.__lastExport)); }`;

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fff;color:#111}</style>
${REACT_CDN}
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="react">
${combined}

${mount}
</script>
</body></html>`;
  }

  function fallbackHtml(message) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#888;text-align:center;padding:24px}</style>
</head><body><div>${message}</div></body></html>`;
  }

  function build(files) {
    if (!files || !files.size) return null;

    const htmlFile =
      findFile(files, (p) => basename(p).toLowerCase() === 'index.html') ||
      findFile(files, (p) => p.toLowerCase().endsWith('.html'));

    if (htmlFile) {
      return inlineHtml(htmlFile.content, files);
    }

    const reactFiles = [...files.entries()]
      .filter(([p]) => /\.(jsx|tsx)$/i.test(p) || (/\.js$/i.test(p) && looksLikeReact(files.get(p))))
      .map(([path, content]) => ({ path, content }));

    if (reactFiles.length) {
      return buildReactHtml(reactFiles);
    }

    return null;
  }

  return { build };
})();
