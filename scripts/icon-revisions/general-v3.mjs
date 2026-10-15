// Independent iteration 3 candidates. Never imported by production generation.
const page='M5 3h9l5 5v13H5ZM14 3v5h5';
export const generalV3 = [
  { id:'file-import-closed', paths:[page,'M21 15H10M14 11l-4 4 4 4'], reason:'Closed page and inward arrow; boundary crossing is explicit and overlaps the right edge.' },
  { id:'file-export-closed', paths:[page,'M10 15h11M17 11l4 4-4 4'], reason:'Closed page with the mirrored outward arrow; no implied interruption of the document boundary.' },
  { id:'file-import-interior', paths:[page,'M16 15H8M11 12l-3 3 3 3'], reason:'Fully interior inward arrow preserves the complete page silhouette, but weakens the entering-file meaning.' },
  { id:'file-export-interior', paths:[page,'M8 15h8M13 12l3 3-3 3'], reason:'Fully interior outward arrow pairs with import while preserving the page silhouette.' },
  { id:'dirty-closed', paths:[page,'M8 18l1-3 6-6 3 3-6 6ZM13 11l3 3'], reason:'Closed page with interior writing tool. Check whether the diagonal pen remains readable in its smaller field.' },
  { id:'hidden-iris-v3', paths:['M3 3l18 18','M8 5c5-2 10 0 14 7l-3 4M15 19c-5 1-10-1-13-7l3-4','M9 12a3 3 0 0 0 3 3'], reason:'Use a shorter iris quarter rather than the dense half-ring from iteration 2.' }
];
export const brandV3 = [
  { id:'brand-separated-stock', paths:['M3 8h6v12H3ZM15 5h6v12h-6Z','M12 2v20'], reason:'A straight wire in the kerf between stock and a displaced offcut. Both material contours are closed.' },
  { id:'brand-guide-stock', paths:['M10 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z','M12 6v16','M3 10h6v11H3ZM15 10h6v7h-3v4h-3Z'], reason:'Guide eye and straight wire separating an angular cut from stock. Avoids a frame or house silhouette.' },
  { id:'brand-curved-stock', paths:['M9 6a7 7 0 0 0 0 14ZM15 6a7 7 0 0 1 0 14Z','M12 2v20'], reason:'Straight wire between two curved material cross-sections. The arced stock differs from a cube or view frame.' }
];
export default generalV3;
