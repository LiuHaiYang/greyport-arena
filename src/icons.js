const icons={
  grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  case:'<rect x="2.5" y="7" width="19" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3"/>',
  keyboard:'<rect x="1.5" y="5" width="21" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M8 15h8"/>',
  volume:'<path d="M3 9h4l5-5v16l-5-5H3zM15 8q5 4 0 8m3-11q7 7 0 14"/>',
  mute:'<path d="M3 9h4l5-5v16l-5-5H3zM16 9l5 6m0-6-5 6"/>',
  expand:'<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/>',
  map:'<path d="m2 5 6-2 8 3 6-2v15l-6 2-8-3-6 2zM8 3v15m8-12v15"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 1v5m11 6h-5m-6 11v-5M1 12h5"/>',
  timer:'<circle cx="12" cy="14" r="8"/><path d="M9 2h6m-3 0v4m6 1 2-2m-8 5v5h3"/>',
  peers:'<circle cx="9" cy="7.5" r="4"/><path d="M1 21v-2a8 8 0 0116 0v2zM16 4a4 4 0 010 8m2 2c3 1 5 3 5 7h-3"/>',
  play:'<path d="m5 2 15 10-15 10z" fill="currentColor" stroke="none"/>',
  network:'<rect x="9" y="2" width="6" height="5"/><rect x="2" y="17" width="6" height="5"/><rect x="16" y="17" width="6" height="5"/><path d="M12 7v5H5v5m7-5h7v5"/>',
  pin:'<path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1114 0z"/><circle cx="12" cy="9" r="2"/>',
  close:'<path d="m5 5 14 14m0-14L5 19"/>',pause:'<path d="M8 4v16m8-16v16" stroke-width="4"/>',
  medical:'<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="currentColor" stroke="none"/>'
};
const icon=k=>'<svg class="ic" aria-hidden="true" viewBox="0 0 24 24">'+icons[k]+'</svg>';
document.querySelectorAll('[data-i]').forEach(n=>n.innerHTML=icon(n.dataset.i));
const networkDrawing='<svg viewBox="0 0 160 160" fill="none" stroke="#b9c9af"><path d="m40 54 46-29 48 29v55l-48 29-46-29z M40 54l46 28 48-28M86 82v56" stroke-dasharray="3 4"/><path d="m35 44 16-9 16 9v19l-16 9-16-9zm0 0 16 9 16-9m-16 9v19m51-32 15-9 16 9v18l-16 9-15-9zm0 0 15 9 16-9m-16 9v18M63 100l18-11 19 11v22l-19 11-18-11zm0 0 18 11 19-11m-19 11v22"/><path d="m68 54 32-4m-48 23v12l11 8m35 4 19-12V69" stroke-width="2"/><circle cx="51" cy="84" r="2"/><circle cx="118" cy="85" r="2"/></svg>';
document.querySelector('.networkart').innerHTML=networkDrawing;
