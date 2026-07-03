// SF Symbols–style inline SVG icon set: geometric line-art, consistent 1.7 stroke,
// round caps/joins, 24px optical grid. Sizes via CSS (1em by default).
window.Icons = (() => {
  const P = {
    // documents / files
    doc: '<path d="M7 3.5h6.4L18 8.1V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5Z"/><path d="M13.4 3.5v3.1A1.5 1.5 0 0 0 14.9 8.1H18"/>',
    folder: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h3.3a1.5 1.5 0 0 1 1.06.44l1 1a1.5 1.5 0 0 0 1.06.44h5.08A1.5 1.5 0 0 1 18.5 9.4v7.6A1.5 1.5 0 0 1 17 18.5H5.5A1.5 1.5 0 0 1 4 17Z"/>',
    // ai / reasoning
    sparkles: '<path fill="currentColor" stroke="none" d="M10 4.2c.62 3.06 1.52 3.96 4.6 4.6-3.08.64-3.98 1.54-4.6 4.6-.62-3.06-1.52-3.96-4.6-4.6 3.08-.64 3.98-1.54 4.6-4.6Z"/><path fill="currentColor" stroke="none" d="M17 13c.34 1.5.86 2.02 2.4 2.4-1.54.38-2.06.9-2.4 2.4-.34-1.5-.86-2.02-2.4-2.4 1.54-.38 2.06-.9 2.4-2.4Z"/>',
    pencil: '<path d="M4 20l1.1-4.1L15.4 5.6a1.6 1.6 0 0 1 2.26 0l.74.74a1.6 1.6 0 0 1 0 2.26L8.1 18.9 4 20Z"/><path d="M14.2 6.8l3 3"/>',
    stack: '<path d="M12 3.8l7.4 3.7-7.4 3.7L4.6 7.5Z"/><path d="M4.6 12l7.4 3.7 7.4-3.7"/><path d="M4.6 16.4l7.4 3.7 7.4-3.7"/>',
    // tools
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="M14.7 14.7 19 19"/>',
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.6 2.3 2.6 13.7 0 16"/><path d="M12 4c-2.6 2.3-2.6 13.7 0 16"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 1.8"/>',
    wrench: '<path d="M15.6 4.4a4 4 0 0 0-4.86 5.14L4.3 16a1.4 1.4 0 0 0 0 2l1.7 1.7a1.4 1.4 0 0 0 2 0l6.42-6.42A4 4 0 0 0 19.6 8.4l-2.5 2.5-2.1-.4-.4-2.1Z"/>',
    wand: '<path d="M5 19 15.5 8.5"/><path d="M13.8 6.8l3.4 3.4"/><path fill="currentColor" stroke="none" d="M18.4 3.6c.24 1.06.6 1.42 1.66 1.66-1.06.24-1.42.6-1.66 1.66-.24-1.06-.6-1.42-1.66-1.66 1.06-.24 1.42-.6 1.66-1.66Z"/><path fill="currentColor" stroke="none" d="M6.4 4.2c.18.8.46 1.08 1.26 1.26-.8.18-1.08.46-1.26 1.26-.18-.8-.46-1.08-1.26-1.26.8-.18 1.08-.46 1.26-1.26Z"/>',
    // arrows / actions
    arrowUp: '<path d="M12 19V6.3"/><path d="M6.5 11 12 5.5 17.5 11"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.2v4.3h-4.3"/>',
    openTab: '<path d="M13.5 5H19v5.5"/><path d="M19 5l-7.5 7.5"/><path d="M18 13.2V17a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 17V8a1.5 1.5 0 0 1 1.5-1.5h3.8"/>',
    download: '<path d="M12 4v10.5"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>',
    play: '<path fill="currentColor" stroke="none" d="M8 5.6v12.8a.6.6 0 0 0 .92.5l10-6.4a.6.6 0 0 0 0-1L8.92 5.1A.6.6 0 0 0 8 5.6Z"/>',
    // ui / status
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    compose: '<path d="M11.5 5H6.8A1.8 1.8 0 0 0 5 6.8v10.4A1.8 1.8 0 0 0 6.8 19h10.4A1.8 1.8 0 0 0 19 17.2V12.5"/><path d="M16.8 3.6 20.4 7.2 12.4 15.2 8.4 16.4 9.6 12.4Z"/>',
    xmark: '<path d="M6.2 6.2 17.8 17.8"/><path d="M17.8 6.2 6.2 17.8"/>',
    check: '<path d="M5 12.5 9.5 17 19 7"/>',
    warning: '<path d="M12 4.6 20.4 19H3.6Z"/><path d="M12 10v4"/><path d="M12 16.4h.01"/>',
    chevron: '<path d="M6 9.5 12 15.5 18 9.5"/>',
    person: '<circle cx="12" cy="8.4" r="3.6"/><path d="M5.6 19a6.4 6.4 0 0 1 12.8 0"/>'
  };

  function get(name, size) {
    const paths = P[name];
    if (!paths) return '';
    const dim = size ? `${size}` : '1em';
    return `<svg class="icon icon-${name}" viewBox="0 0 24 24" width="${dim}" height="${dim}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  return { get };
})();
