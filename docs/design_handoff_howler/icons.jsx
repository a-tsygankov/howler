/* global React */
// Icon sets — three styles for the same set of category concepts.
// Sizes: 24 default, accept className/size.

const ICONS = (() => {
  const names = ['paw','broom','heart','briefcase','pill','plant','bowl','bell','check','clock','calendar','flame','star','dog','cat','home','tooth','run','book','sparkle','more','plus','filter'];
  return names;
})();

// ---- Set A: Hand-drawn, organic line (warm-domestic) ----
function IconA({ name, size = 24, color = "currentColor" }) {
  const s = size;
  const stroke = color;
  const sw = 1.7;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    paw: <g><circle cx="7.5" cy="9" r="1.6"/><circle cx="11" cy="6.5" r="1.6"/><circle cx="14.5" cy="6.5" r="1.6"/><circle cx="18" cy="9" r="1.6"/><path d="M8 16.5c0-3 1.8-4.5 4.2-4.5s4 1.5 4 4.5c0 2-1.7 2.6-3 2-.7-.3-1.5-.3-2.2 0-1.4.6-3-.1-3-2z"/></g>,
    broom: <g><path d="M14 4l-7 7"/><path d="M16 6l4 4"/><path d="M11 9l-5 8 8-5"/><path d="M6 17l-2 3"/></g>,
    heart: <path d="M12 19s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 9c0 5.6-7 10-7 10z"/>,
    briefcase: <g><rect x="3.5" y="7" width="17" height="12" rx="1.5"/><path d="M9 7V5.5a1 1 0 011-1h4a1 1 0 011 1V7"/><path d="M3.5 12h17"/></g>,
    pill: <g><rect x="3.2" y="9" width="17.6" height="6" rx="3" transform="rotate(-30 12 12)"/><path d="M8 16l8-8"/></g>,
    plant: <g><path d="M12 20v-7"/><path d="M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 13c3 0 5-2 5-5-3 0-5 2-5 5z"/><path d="M7.5 20h9"/></g>,
    bowl: <g><path d="M4 12h16l-2 6a2 2 0 01-2 2H8a2 2 0 01-2-2z"/><path d="M9 9c0-1.5 1.5-2 3-2s3 .5 3 2"/></g>,
    bell: <g><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/></g>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5"/>,
    clock: <g><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></g>,
    calendar: <g><rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M4 10h16M9 4v3M15 4v3"/></g>,
    flame: <path d="M12 21c-3.5 0-6-2.4-6-5.5 0-2.5 1.8-3.6 2.7-5.5.6-1.4.3-3 .3-3 2 .8 3 2.5 3 4 1.5-.7 2-2.5 2-4 2.5 2 4 4.5 4 8 0 3.6-2.5 6-6 6z"/>,
    star: <path d="M12 4l2.5 5 5.5.8-4 4 1 5.6L12 17l-5 2.4 1-5.6-4-4 5.5-.8z"/>,
    dog: <g><path d="M5 9l-1-3 4 1 1 2"/><path d="M19 9l1-3-4 1-1 2"/><path d="M7 11c0-3 2-5 5-5s5 2 5 5v6a2 2 0 01-2 2h-6a2 2 0 01-2-2z"/><circle cx="10" cy="13" r=".7" fill={stroke}/><circle cx="14" cy="13" r=".7" fill={stroke}/></g>,
    cat: <g><path d="M5 8l1 4"/><path d="M19 8l-1 4"/><path d="M5 8c2-2 4-3 7-3s5 1 7 3v9a2 2 0 01-2 2H7a2 2 0 01-2-2z"/><circle cx="10" cy="13" r=".7" fill={stroke}/><circle cx="14" cy="13" r=".7" fill={stroke}/></g>,
    home: <g><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/></g>,
    tooth: <path d="M8 4c2 0 2 1.5 4 1.5S14 4 16 4c2.5 0 4 2 4 4 0 4-2 5-3 9-.4 1.5-1.6 2-2.5.5l-1.5-3a1 1 0 00-2 0l-1.5 3c-.9 1.5-2 1-2.5-.5-1-4-3-5-3-9 0-2 1.5-4 4-4z"/>,
    run: <g><circle cx="15" cy="5" r="1.6"/><path d="M9 21l3-6 3 2 2 4"/><path d="M5 13l3-2 4 2 2-4"/></g>,
    book: <g><path d="M5 5h6c1 0 2 1 2 2v13c0-1-1-2-2-2H5z"/><path d="M19 5h-6c-1 0-2 1-2 2v13c0-1 1-2 2-2h6z"/></g>,
    sparkle: <g><path d="M12 4v6M12 14v6M4 12h6M14 12h6"/></g>,
    more: <g><circle cx="6" cy="12" r="1.3" fill={stroke}/><circle cx="12" cy="12" r="1.3" fill={stroke}/><circle cx="18" cy="12" r="1.3" fill={stroke}/></g>,
    plus: <g><path d="M12 5v14M5 12h14"/></g>,
    filter: <g><path d="M4 6h16M7 12h10M10 18h4"/></g>,
  };
  return <svg {...common}>{paths[name] || <circle cx="12" cy="12" r="8"/>}</svg>;
}

// ---- Set B: Solid filled, friendly geometric (playful but warm) ----
function IconB({ name, size = 24, color = "currentColor" }) {
  const s = size;
  const fill = color;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill };
  const paths = {
    paw: <g><circle cx="7.5" cy="9" r="2"/><circle cx="11" cy="6.2" r="2"/><circle cx="13" cy="6.2" r="2"/><circle cx="16.5" cy="9" r="2"/><path d="M12 10c-3 0-5 2-5 5 0 2.4 2.6 3.2 4 2.5.6-.3 1.4-.3 2 0 1.4.7 4-.1 4-2.5 0-3-2-5-5-5z"/></g>,
    broom: <g><path d="M14 3l-9 9 3 3 9-9z"/><path d="M16 14l-2 7h-2l1-5z" opacity=".75"/></g>,
    heart: <path d="M12 20s-8-4.5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 9c0 6.5-8 11-8 11z"/>,
    briefcase: <g><rect x="3" y="7" width="18" height="13" rx="2"/><rect x="9" y="4" width="6" height="3" rx="1" /><rect x="3" y="11" width="18" height="2" fill="#fff" opacity=".55"/></g>,
    pill: <g><rect x="2.5" y="9" width="19" height="6" rx="3" transform="rotate(-30 12 12)"/><rect x="2.5" y="9" width="9.5" height="6" transform="rotate(-30 12 12)" fill="#fff" opacity=".4"/></g>,
    plant: <g><rect x="8" y="17" width="8" height="4" rx="1"/><path d="M12 17c-4 0-6-2.5-6-6 4 0 6 3 6 6z"/><path d="M12 17c4 0 6-2.5 6-6-4 0-6 3-6 6z"/></g>,
    bowl: <g><path d="M3 11h18l-2 8a2 2 0 01-2 1.5H7a2 2 0 01-2-1.5z"/><ellipse cx="12" cy="11" rx="9" ry="2.2"/></g>,
    bell: <g><path d="M5 17h14l-1.5-2V11a5.5 5.5 0 10-11 0v4z"/><path d="M10 19a2 2 0 004 0z"/></g>,
    check: <path d="M5 12.5l4 4 10-10-1.5-1.5L9 13.5l-2.5-2.5z"/>,
    clock: <g><circle cx="12" cy="12" r="9"/><path d="M11 7h2v6l4 2-1 1.5-5-2.5z" fill="#fff" opacity=".7"/></g>,
    calendar: <g><rect x="3" y="5" width="18" height="16" rx="2"/><rect x="3" y="5" width="18" height="5" fill="#fff" opacity=".35"/><rect x="7" y="3" width="2" height="4" rx="1"/><rect x="15" y="3" width="2" height="4" rx="1"/></g>,
    flame: <path d="M12 22c-4 0-7-2.5-7-6 0-3 2-4 3-6 .7-1.4.3-3.5.3-3.5 2.5 1 3.7 3 3.7 4.5C13 9.5 14 8 14 6c3 2.4 5 5 5 9 0 4-3 7-7 7z"/>,
    star: <path d="M12 3l2.7 6 6.3.9-4.5 4.5 1 6.6L12 18l-5.5 3 1-6.6L3 9.9 9.3 9z"/>,
    dog: <g><path d="M5 5l3 1.5L7 11z"/><path d="M19 5l-3 1.5L17 11z"/><rect x="6" y="9" width="12" height="12" rx="3"/><circle cx="10" cy="14" r="1" fill="#fff"/><circle cx="14" cy="14" r="1" fill="#fff"/></g>,
    cat: <g><path d="M5 6l3 4L5 11z"/><path d="M19 6l-3 4 3 1z"/><rect x="5" y="9" width="14" height="12" rx="3"/><circle cx="10" cy="14" r="1" fill="#fff"/><circle cx="14" cy="14" r="1" fill="#fff"/></g>,
    home: <path d="M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1z"/>,
    tooth: <path d="M8 3c2 0 2 1.5 4 1.5S14 3 16 3c3 0 4.5 2.5 4.5 5 0 4.5-2.5 5-3.5 9.5-.5 2-2 2-2.7.3l-1.3-3.3a1 1 0 00-2 0l-1.3 3.3c-.7 1.7-2.2 1.7-2.7-.3C5 13 3.5 12.5 3.5 8 3.5 5.5 5 3 8 3z"/>,
    run: <g><circle cx="15" cy="5" r="2"/><path d="M9.5 21l3-7 3.5 2.5 2 4.5"/><path d="M5 14l3.5-3 4.5 2.5L15 9.5"/></g>,
    book: <g><path d="M4 4h7v17H6a2 2 0 01-2-2z"/><path d="M20 4h-7v17h5a2 2 0 002-2z"/></g>,
    sparkle: <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/>,
    more: <g><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></g>,
    plus: <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>,
    filter: <path d="M4 6h16l-6 7v6l-4-2v-4z"/>,
  };
  return <svg {...common}>{paths[name] || <circle cx="12" cy="12" r="8"/>}</svg>;
}

// ---- Set C: Editorial mark — minimal geometric strokes (utility) ----
function IconC({ name, size = 24, color = "currentColor" }) {
  const s = size;
  const stroke = color;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.2, strokeLinecap: "square", strokeLinejoin: "miter" };
  const paths = {
    paw: <g><circle cx="8" cy="9" r="1.4"/><circle cx="12" cy="7" r="1.4"/><circle cx="16" cy="9" r="1.4"/><circle cx="6" cy="13" r="1.2"/><circle cx="18" cy="13" r="1.2"/><circle cx="12" cy="16" r="2.6"/></g>,
    broom: <g><path d="M14 4L7 11"/><path d="M11 8l5 5"/><path d="M6 12l-2 8 8-2"/></g>,
    heart: <path d="M12 19L5 12a3.5 3.5 0 015-5l2 2 2-2a3.5 3.5 0 015 5z"/>,
    briefcase: <g><rect x="4" y="8" width="16" height="11"/><path d="M9 8V5h6v3"/><path d="M4 13h16"/></g>,
    pill: <g><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-30 12 12)"/><path d="M9 16l6-6"/></g>,
    plant: <g><path d="M12 20V12"/><path d="M12 12c-3 0-5-2-5-5"/><path d="M12 12c3 0 5-2 5-5"/><path d="M8 20h8"/></g>,
    bowl: <g><path d="M4 12h16v2c0 4-3 6-8 6s-8-2-8-6z"/><path d="M9 9c.5-1 1.5-1.5 3-1.5s2.5.5 3 1.5"/></g>,
    bell: <g><path d="M7 16V11a5 5 0 0110 0v5l1 2H6z"/><path d="M11 20h2"/></g>,
    check: <path d="M5 12l4 4 10-10"/>,
    clock: <g><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></g>,
    calendar: <g><rect x="4" y="6" width="16" height="14"/><path d="M4 10h16"/><path d="M9 4v4M15 4v4"/></g>,
    flame: <path d="M12 21c-3 0-6-2-6-5s2-3 3-6 0-4 0-4 4 2 4 5 2-1 2-3c2 2 3 4 3 8 0 3-3 5-6 5z"/>,
    star: <path d="M12 4l2.5 5 5.5.8-4 4 1 5.6L12 17l-5 2.4 1-5.6-4-4 5.5-.8z"/>,
    dog: <g><path d="M6 9l-1-4 4 2"/><path d="M18 9l1-4-4 2"/><rect x="6" y="9" width="12" height="11"/><circle cx="10" cy="14" r=".5" fill={stroke}/><circle cx="14" cy="14" r=".5" fill={stroke}/></g>,
    cat: <g><path d="M5 6l3 5"/><path d="M19 6l-3 5"/><rect x="5" y="9" width="14" height="12"/><circle cx="10" cy="14" r=".5" fill={stroke}/><circle cx="14" cy="14" r=".5" fill={stroke}/></g>,
    home: <g><path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/></g>,
    tooth: <path d="M8 4c2 0 2 1 4 1s2-1 4-1c2 0 4 2 4 4s-1 4-2 8-2 4-3 1l-1-3h-4l-1 3c-1 3-2 3-3-1S4 12 4 8s2-4 4-4z"/>,
    run: <g><circle cx="15" cy="5" r="1.5"/><path d="M9 21l3-6 3 2 2 4M5 13l3-2 4 2 2-4"/></g>,
    book: <g><path d="M5 5h6v15H5z"/><path d="M13 5h6v15h-6z"/></g>,
    sparkle: <g><path d="M12 5v14"/><path d="M5 12h14"/></g>,
    more: <g><circle cx="6" cy="12" r=".8" fill={stroke}/><circle cx="12" cy="12" r=".8" fill={stroke}/><circle cx="18" cy="12" r=".8" fill={stroke}/></g>,
    plus: <g><path d="M12 5v14M5 12h14"/></g>,
    filter: <g><path d="M4 6h16l-6 7v6l-4-2v-4z"/></g>,
  };
  return <svg {...common}>{paths[name] || <circle cx="12" cy="12" r="8"/>}</svg>;
}

window.HOWLER_ICONS = { IconA, IconB, IconC, NAMES: ICONS };
