export const GUIDE_LANGUAGES = {
  en: 'EN',
  ro: 'RO'
};

export const GUIDE_COPY = {
  en: {
    title: 'User Manual',
    buttonLabel: 'Controls',
    closeLabel: 'Close guide',
    languageLabel: 'Language',
    highlightLabel: 'Show me',
    overview: 'A complete guide for loading, viewing, measuring, editing, pinning, and exporting Wire EDM G-code.',
    sections: [
      {
        title: '1. Load and Inspect a File',
        steps: [
          {
            text: 'Click the Load G-Code File button or drag a .gcode, .nc, .txt, or .iso file onto it.',
            mock: { label: 'Load G-Code File' },
            highlight: { selector: '[data-toolbar="file-input-label"]' }
          },
          {
            text: 'After loading, the canvas fits the toolpath and the right sidebar updates path statistics: total moves, rapid moves, cutting moves, arcs, bounds, and file name.'
          },
          {
            text: 'Use Current Position to read the mouse X/Y coordinates while moving over the canvas.'
          }
        ]
      },
      {
        title: '2. Navigate the Canvas',
        steps: [
          { text: 'Use the mouse wheel to zoom in and out around the pointer.' },
          {
            text: 'Use Zoom +, Zoom -, and Fit to Screen when you want predictable view changes.',
            mock: { label: 'Fit to Screen' },
            highlight: { selector: '[data-toolbar="fit-to-screen"]' }
          },
          { text: 'Hold Shift and drag/click on the canvas to pan the view.' },
          { text: 'Press G to toggle grid snap on or off. The Grid Snap value in the sidebar reflects the current state.' }
        ]
      },
      {
        title: '3. Measure Points',
        steps: [
          { text: 'Click the canvas to add measurement points. They appear as P1, P2, and so on in the Clicked Points list.' },
          {
            text: 'Click Clear Points to remove all measurement points.',
            mock: { label: 'Clear Points' },
            highlight: { selector: '[data-toolbar="clear-points"]' }
          },
          {
            text: 'Click Export ISO to export clicked points as an ISO program.',
            mock: { label: 'Export ISO' },
            highlight: { selector: '[data-toolbar="export-points"]' }
          }
        ]
      },
      {
        title: '4. Open and Read the G-Code Drawer',
        steps: [
          {
            text: 'Click G-Code Drawer to open or close the bottom/right drawer.',
            mock: { label: 'G-Code Drawer' },
            highlight: { selector: '[data-toolbar="toggle-gcode-drawer"]' }
          },
          { text: 'The drawer organizes the program into Header, open/closed toolpaths, rapid/setup groups, and Footer.' },
          { text: 'Hover a drawer row to preview its endpoint on the canvas with a temporary orange marker.' }
        ]
      },
      {
        title: '5. Select Rows for Editing',
        steps: [
          { text: 'In Select mode, click a row to select it. The canvas shows a temporary selection highlight for the selected endpoint.' },
          { text: 'Ctrl/Cmd-click toggles unrelated rows for bulk actions. Shift-click selects a continuous range.' },
          {
            text: 'Click the X lines selected counter or press Escape to clear drawer selection and temporary canvas highlights.',
            mock: { label: '1 line selected' },
            highlight: { selector: '[data-action="clear-selection"]', drawer: true }
          },
          { text: 'Selection is temporary. Use pins when you want reference points to remain visible.' }
        ]
      },
      {
        title: '6. Pin Canvas References',
        steps: [
          {
            text: 'Hover a drawer row and click its pin icon to keep that endpoint highlighted on the canvas.',
            mock: { label: '📌', tone: 'danger' },
            highlight: { selector: '.gcode-line-pin', drawer: true }
          },
          { text: 'Pinned rows keep a visible pin indicator in the drawer and red PIN markers on the canvas.' },
          {
            text: 'Use the red pin button in the drawer header to clear all pinned canvas highlights.',
            mock: { label: '📌', tone: 'danger' },
            highlight: { selector: '[data-action="clear-pins"]', drawer: true }
          }
        ]
      },
      {
        title: '7. Edit and Reorder G-Code',
        steps: [
          {
            text: 'Click Edit to edit line text directly. Blur commits the edit and reparses the program.',
            mock: { label: 'Edit' },
            highlight: { selector: '[data-mode="edit"]', drawer: true }
          },
          { text: 'Undo and redo are available from the drawer header. Browser undo/redo still applies while typing inside a line.' },
          {
            text: 'With rows selected, use Start Here to rotate the selected toolpath so the chosen motion line becomes the new start.',
            mock: { label: 'Start Here' },
            highlight: { selector: '[data-action="set-start"]', drawer: true }
          },
          { text: 'Use ↑ and ↓ to move selected rows or folder groups. Use the delete button to remove selected rows.' },
          { text: 'Use + Points to insert clicked measurement points after the selected path row.' }
        ]
      },
      {
        title: '8. Normalize and Export Programs',
        steps: [
          {
            text: 'Click Normalize to ISO to create a clean ISO file from the current drawer text.',
            mock: { label: 'Normalize to ISO' },
            highlight: { selector: '[data-toolbar="normalize-to-iso"]' }
          },
          { text: 'Normalization removes old block numbers, standardizes motion codes, keeps useful setup commands, and emits a clean M02 ending.' },
          { text: 'Supported motion includes G0/G1 linear moves and G2/G3 arcs with I/J centers. X/Y are visualized; Z is parsed but ignored for drawing.' }
        ]
      }
    ]
  },
  ro: {
    title: 'Manual de utilizare',
    buttonLabel: 'Comenzi',
    closeLabel: 'Închide ghidul',
    languageLabel: 'Limbă',
    highlightLabel: 'Arată-mi',
    overview: 'Ghid complet pentru încărcare, vizualizare, măsurare, editare, fixare și export Wire EDM G-code.',
    sections: [
      {
        title: '1. Încarcă și inspectează un fișier',
        steps: [
          {
            text: 'Apasă Load G-Code File sau trage un fișier .gcode, .nc, .txt ori .iso peste buton.',
            mock: { label: 'Load G-Code File' },
            highlight: { selector: '[data-toolbar="file-input-label"]' }
          },
          { text: 'După încărcare, canvasul încadrează traseul, iar bara din dreapta afișează statistici: mișcări totale, rapide, de tăiere, arce, limite și numele fișierului.' },
          { text: 'Folosește Current Position ca să vezi coordonatele X/Y ale mouse-ului pe canvas.' }
        ]
      },
      {
        title: '2. Navighează pe canvas',
        steps: [
          { text: 'Folosește rotița mouse-ului pentru zoom în jurul cursorului.' },
          {
            text: 'Folosește Zoom +, Zoom - și Fit to Screen când vrei schimbări controlate ale vizualizării.',
            mock: { label: 'Fit to Screen' },
            highlight: { selector: '[data-toolbar="fit-to-screen"]' }
          },
          { text: 'Ține Shift și trage/click pe canvas pentru pan.' },
          { text: 'Apasă G pentru a activa sau dezactiva grid snap. Valoarea Grid Snap din sidebar arată starea curentă.' }
        ]
      },
      {
        title: '3. Măsoară puncte',
        steps: [
          { text: 'Click pe canvas pentru a adăuga puncte de măsurare. Ele apar ca P1, P2 etc. în lista Clicked Points.' },
          {
            text: 'Apasă Clear Points pentru a șterge toate punctele de măsurare.',
            mock: { label: 'Clear Points' },
            highlight: { selector: '[data-toolbar="clear-points"]' }
          },
          {
            text: 'Apasă Export ISO pentru a exporta punctele într-un program ISO.',
            mock: { label: 'Export ISO' },
            highlight: { selector: '[data-toolbar="export-points"]' }
          }
        ]
      },
      {
        title: '4. Deschide și citește drawer-ul G-code',
        steps: [
          {
            text: 'Apasă G-Code Drawer pentru a deschide sau închide drawer-ul.',
            mock: { label: 'G-Code Drawer' },
            highlight: { selector: '[data-toolbar="toggle-gcode-drawer"]' }
          },
          { text: 'Drawer-ul împarte programul în Header, trasee deschise/închise, grupuri rapide/setup și Footer.' },
          { text: 'Hover peste o linie pentru a previzualiza endpoint-ul pe canvas cu un marker portocaliu temporar.' }
        ]
      },
      {
        title: '5. Selectează linii pentru editare',
        steps: [
          { text: 'În Select mode, click pe o linie o selectează. Canvasul afișează temporar endpoint-ul selectat.' },
          { text: 'Ctrl/Cmd-click selectează linii separate pentru acțiuni bulk. Shift-click selectează un interval continuu.' },
          {
            text: 'Click pe contorul X lines selected sau apasă Escape ca să cureți selecția și highlight-urile temporare.',
            mock: { label: '1 line selected' },
            highlight: { selector: '[data-action="clear-selection"]', drawer: true }
          },
          { text: 'Selecția este temporară. Folosește pin-uri pentru repere care trebuie să rămână vizibile.' }
        ]
      },
      {
        title: '6. Fixează repere pe canvas',
        steps: [
          {
            text: 'Hover peste o linie din drawer și apasă iconița pin ca endpoint-ul să rămână evidențiat pe canvas.',
            mock: { label: '📌', tone: 'danger' },
            highlight: { selector: '.gcode-line-pin', drawer: true }
          },
          { text: 'Liniile pinned păstrează un indicator în drawer și markere roșii PIN pe canvas.' },
          {
            text: 'Folosește pin-ul roșu din header-ul drawer-ului ca să ștergi toate reperele pinned.',
            mock: { label: '📌', tone: 'danger' },
            highlight: { selector: '[data-action="clear-pins"]', drawer: true }
          }
        ]
      },
      {
        title: '7. Editează și reordonează G-code',
        steps: [
          {
            text: 'Apasă Edit pentru a modifica textul liniilor direct. Când ieși din linie, modificarea se aplică și programul este reparsat.',
            mock: { label: 'Edit' },
            highlight: { selector: '[data-mode="edit"]', drawer: true }
          },
          { text: 'Undo și redo sunt disponibile în header-ul drawer-ului. În timp ce scrii într-o linie, undo/redo ale browserului rămân active.' },
          {
            text: 'Cu o linie selectată, Start Here rotește traseul astfel încât linia motion aleasă devine noul start.',
            mock: { label: 'Start Here' },
            highlight: { selector: '[data-action="set-start"]', drawer: true }
          },
          { text: 'Folosește ↑ și ↓ pentru a muta linii sau foldere. Folosește delete pentru a șterge liniile selectate.' },
          { text: 'Folosește + Points pentru a insera punctele măsurate după linia de traseu selectată.' }
        ]
      },
      {
        title: '8. Normalizează și exportă programe',
        steps: [
          {
            text: 'Apasă Normalize to ISO pentru a crea un fișier ISO curat din textul curent din drawer.',
            mock: { label: 'Normalize to ISO' },
            highlight: { selector: '[data-toolbar="normalize-to-iso"]' }
          },
          { text: 'Normalizarea elimină numerele N vechi, standardizează codurile motion, păstrează comenzile setup utile și emite un M02 final curat.' },
          { text: 'Sunt suportate mișcări G0/G1 și arce G2/G3 cu centre I/J. X/Y sunt vizualizate; Z este parsat, dar ignorat la desenare.' }
        ]
      }
    ]
  }
};

export function getGuideCopy(language = 'en') {
  return GUIDE_COPY[language] || GUIDE_COPY.en;
}

export default { GUIDE_LANGUAGES, GUIDE_COPY, getGuideCopy };
