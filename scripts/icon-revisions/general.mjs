// Proposed iteration 2 refinements. Reviewed independently; not applied globally.
const page = 'M5 21V3h9l5 5v3M14 3v5h5M5 21h5';
export const generalRevisions = [
  { id:'file-new', paths:[page, 'M16 12v8M12 16h8'], reason:'Use the same interrupted page and lower-right modifier field as import and export.' },
  { id:'file-import', paths:[page, 'M21 16h-9M16 12l-4 4 4 4'], reason:'Mirror the export arrow into the page. Importing an app file should differ from uploading to storage.' },
  { id:'file-export', paths:[page, 'M12 16h9M17 12l4 4-4 4'], reason:'Keep the paired import/export page geometry and modifier center identical.' },
  { id:'file-inspect', paths:[page, 'M12 16a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z', 'M19 19l3 3'], reason:'Center the inspection badge in the shared lower-right modifier field.' },
  { id:'file-body', paths:[page, 'M11 15l5-2 5 2v5l-5 2-5-2ZM11 15l5 2 5-2M16 17v5'], reason:'Match the exact page outline of the other modified document glyphs.' },
  { id:'copy', paths:['M8 8h13v13H8ZM16 8V3H3v13h5'], reason:'Make the two copied sheets the same square dimensions. The original front sheet is narrower.' },
  { id:'folder-plus', paths:['M3 21V4h6l3 3h9v14ZM3 10h18', 'M16 12v6M13 15h6'], reason:'Use a closed folder with a full-width lid seam. The original seam ended arbitrarily inside the folder.' },
  { id:'folder-storage', paths:['M3 21V4h6l3 3h9v14ZM3 10h18', 'M6 17h8M18 17h.1'], reason:'Name the optional folder persistence flow with a folder rather than an anonymous hard disk. Retain a restrained storage slot.' },
  { id:'hidden', paths:['M3 3l18 18', 'M8 5c5-2 10 0 14 7l-3 4M15 19c-5 1-10-1-13-7l3-4', 'M10 10a3 3 0 0 0 4 4'], reason:'Retain the iris fragment so hidden geometry still reads as the visible-eye family under its slash.' },
  { id:'busy', paths:['M12 3a9 9 0 1 1-9 9'], reason:'Remove the detached diagonal fleck. One continuous three-quarter ring gives a clean spinner gap at 14px.' },
  { id:'dirty', paths:[page, 'M12 21l1-4 6-6 3 3-6 6ZM17 13l3 3'], reason:'A page with writing identifies changed document content. The original two text lines identify any document rather than unsaved changes.' },
  { id:'navigation-trackpad', paths:['M4 4h16v16H4ZM4 16h16M12 16v4'], reason:'Show the trackpad and its click zones directly. The original depicts a laptop screen with only a tiny trackpad hint.' },
  { id:'wire-edm-mark', paths:['M3 21V7h7v5h4V7h7v14Z', 'M12 2v20'], reason:'Show the wire passing through a notched workpiece. Avoid the previous framed arrow and the first proposal\'s house-shaped roof.' }
];
export default generalRevisions;
