export type EditorGuideLanguage = 'en' | 'ro';

export type EditorGuideTarget =
  | 'import-program'
  | 'preview'
  | 'grid-snap'
  | 'measurement-points'
  | 'program-lines'
  | 'line-modes'
  | 'selection-counter'
  | 'clear-pins'
  | 'normalize-draft'
  | 'export-iso'
  | 'save-program';

export interface EditorGuideStep {
  text: string;
  mock?: {
    label: string;
    tone?: 'danger' | 'primary';
  };
  highlightTarget?: EditorGuideTarget;
}

export interface EditorGuideSection {
  title: string;
  steps: EditorGuideStep[];
}

export interface EditorGuideCopy {
  title: string;
  overview: string;
  closeLabel: string;
  highlightLabel: string;
  languageLabel: string;
  sections: EditorGuideSection[];
}

export const EDITOR_GUIDE_LANGUAGES: Record<EditorGuideLanguage, string> = {
  en: 'EN',
  ro: 'RO'
};

export const EDITOR_GUIDE_COPY: Record<EditorGuideLanguage, EditorGuideCopy> = {
  en: {
    title: 'Wire EDM Workbench Manual',
    overview:
      'A practical guide for local storage work, DXF path planning, editor inspection, measurement, pinning, cleanup, and final export.',
    closeLabel: 'Close guide',
    highlightLabel: 'Show me',
    languageLabel: 'Language',
    sections: [
      {
        title: '1. Workbench And Storage',
        steps: [
          {
            text: 'The app prepares local storage automatically. Imported work, templates, UPID path projects, and editor files are kept in the browser-managed workbench until you export them or clear browser data.'
          },
          {
            text: 'Use a workbench folder for disk-visible storage. If the remembered folder needs permission again, Settings shows Reconnect Workbench Folder; otherwise it asks you to choose the folder.'
          },
          {
            text: 'Machine profile templates, work area limits, and output extension choices live in the active workbench. The extension changes the written file name, not the planned path.'
          }
        ]
      },
      {
        title: '2. Import Flows',
        steps: [
          {
            text: 'From the dashboard, import a DXF to create a clean internal path project. G-code is posted later from the active path plan and machine profile.'
          },
          {
            text: 'From the editor, click Import Program or drag in .gcode, .nc, .iso, or .txt files. External programs pass through the cleanup/display pipeline before preview and editing.',
            mock: { label: 'Import Program', tone: 'primary' },
            highlightTarget: 'import-program'
          },
          {
            text: 'DXF projects open in the UPID Path Navigator. External posted programs keep the old cleanup and Program Lines behavior.'
          }
        ]
      },
      {
        title: '3. Preview Navigation',
        steps: [
          {
            text: 'The preview shows rapid and cut moves, start/end markers, selected rows, hovered rows, pinned references, measurement points, the grid, and axes.',
            highlightTarget: 'preview'
          },
          {
            text: 'Use the preview toolbar, Ctrl/Cmd +/- shortcuts, mouse wheel, or Fit to Screen to zoom. Shift-drag or middle-drag pans the view.'
          },
          {
            text: 'Press G to toggle grid visibility. Current Position shows live mouse coordinates over the preview.'
          },
          {
            text: 'Enable Grid Snap when cursor coordinates and clicked measurement points should land on the 5 mm preview grid.',
            mock: { label: 'Grid Snap ON' },
            highlightTarget: 'grid-snap'
          }
        ]
      },
      {
        title: '4. Measurement Points',
        steps: [
          {
            text: 'Click the preview to add P1, P2, and later points. You can also type exact X/Y values and click Add Point.',
            highlightTarget: 'measurement-points'
          },
          {
            text: 'Delete individual points from the list, or use Clear Points to empty the list. Remaining points are reindexed automatically.'
          },
          {
            text: 'Insert Points is for external posted programs. DXF path projects keep measurement and magnetized points on the canvas; Export CSV, Export G-code, and Export Point ISO write point-only files for outside use.'
          },
          {
            text: 'Ctrl/Cmd+C clears all measurement points when focus is not inside an input or the program editor.'
          }
        ]
      },
      {
        title: '5. UPID Path Navigator Or Program Lines',
        steps: [
          {
            text: 'DXF path projects use the UPID Path Navigator for contour order, contour role correction, direction, start selection, segment inspection, hover assist, and tangent/perpendicular construction.',
            highlightTarget: 'program-lines'
          },
          {
            text: 'External posted programs show Program Lines, grouped into header, body contours, and footer. Collapse groups to keep large programs readable.',
            highlightTarget: 'program-lines'
          },
          {
            text: 'Close or reopen Program Lines from its header when you need more room for the preview without losing the current draft.',
            mock: { label: 'Close drawer' },
            highlightTarget: 'program-lines'
          },
          {
            text: 'Select mode is for row selection. Edit mode changes the row into an inline editor and commits on blur.',
            mock: { label: 'Select / Edit' },
            highlightTarget: 'line-modes'
          },
          {
            text: 'Click selects a row. Ctrl/Cmd-click toggles unrelated rows. Shift-click selects every row between the last click and the new click.'
          },
          {
            text: 'The selected counter is clickable and Escape clears selection. This removes temporary canvas highlights without touching pinned reference points.',
            mock: { label: '2 selected' },
            highlightTarget: 'selection-counter'
          },
          {
            text: 'Hover a row and use its pin button to keep that endpoint highlighted on the preview. The red pin button clears all pinned references.',
            mock: { label: 'Pin', tone: 'danger' },
            highlightTarget: 'clear-pins'
          }
        ]
      },
      {
        title: '6. Editing And Export',
        steps: [
          {
            text: 'For DXF path projects, reorder operations, correct contour roles, reverse direction, or set starts from the path surface. Manual UPID decisions are recorded in the selected geometry inspector. For external posted programs, move selected rows, delete rows, undo/redo draft changes, or use Start Here.'
          },
          {
            text: 'Normalize Draft rewrites the current editor text into the app ISO style without downloading a file.',
            mock: { label: 'Normalize Draft' },
            highlightTarget: 'normalize-draft'
          },
          {
            text: 'Export ISO downloads a normalized ISO copy without mutating the current draft.',
            mock: { label: 'Export ISO' },
            highlightTarget: 'export-iso'
          },
          {
            text: 'Save Path Plan writes DXF path decisions back to the project. Save Program writes an external posted-program draft back to the active workbench entry.',
            mock: { label: 'Save Path Plan' },
            highlightTarget: 'save-program'
          }
        ]
      }
    ]
  },
  ro: {
    title: 'Manual Wire EDM Workbench',
    overview:
      'Ghid practic pentru lucru in local storage, planificare DXF, inspectie in editor, masurare, pinning, cleanup si export final.',
    closeLabel: 'Inchide ghidul',
    highlightLabel: 'Arata-mi',
    languageLabel: 'Limba',
    sections: [
      {
        title: '1. Workbench si stocare',
        steps: [
          {
            text: 'Aplicatia pregateste local storage automat. Lucrarile importate, template-urile, programele generate si fisierele de editor raman in workbench-ul gestionat de browser pana le exporti sau stergi datele browserului.'
          },
          {
            text: 'Foloseste un folder workbench pentru stocare vizibila pe disk. Daca folderul retinut cere permisiune din nou, Settings arata Reconnect Workbench Folder; altfel cere sa alegi folderul.'
          },
          {
            text: 'Template-urile din profilul de masina, limitele zonei de lucru si extensia de output tin de workbench-ul activ. Extensia schimba numele fisierului, nu path-ul planificat.'
          }
        ]
      },
      {
        title: '2. Flow-uri de import',
        steps: [
          {
            text: 'Din dashboard, importa un DXF ca sa creezi un proiect intern de path. G-code-ul se posteaza mai tarziu din planul de path si profilul de masina activ.'
          },
          {
            text: 'Din editor, apasa Import Program sau trage fisiere .gcode, .nc, .iso ori .txt. Programele externe trec prin pipeline-ul de cleanup/display inainte de preview si editare.',
            mock: { label: 'Import Program', tone: 'primary' },
            highlightTarget: 'import-program'
          },
          {
            text: 'Proiectele DXF se deschid in UPID Path Navigator. Programele externe postate pastreaza cleanup-ul vechi si Program Lines.'
          }
        ]
      },
      {
        title: '3. Navigare preview',
        steps: [
          {
            text: 'Preview-ul arata miscari rapide si de taiere, markere start/end, randuri selectate, randuri hover, repere pinned, puncte de masurare, grid si axe.',
            highlightTarget: 'preview'
          },
          {
            text: 'Foloseste toolbar-ul de preview, shortcut-uri Ctrl/Cmd +/-, rotita mouse-ului sau Fit to Screen pentru zoom. Shift-drag sau middle-drag face pan.'
          },
          {
            text: 'Apasa G ca sa ascunzi sau afisezi gridul. Current Position arata coordonatele live ale mouse-ului pe preview.'
          },
          {
            text: 'Activeaza Grid Snap cand coordonatele cursorului si punctele adaugate prin click trebuie sa cada pe gridul de 5 mm.',
            mock: { label: 'Grid Snap ON' },
            highlightTarget: 'grid-snap'
          }
        ]
      },
      {
        title: '4. Puncte de masurare',
        steps: [
          {
            text: 'Click pe preview adauga P1, P2 si urmatoarele puncte. Poti introduce si valori exacte X/Y, apoi Add Point.',
            highlightTarget: 'measurement-points'
          },
          {
            text: 'Sterge puncte individual din lista sau foloseste Clear Points pentru lista goala. Punctele ramase se reindexeaza automat.'
          },
          {
            text: 'Insert Points este pentru programe externe postate. Proiectele DXF pastreaza punctele de masurare si punctele magnetizate pe canvas; Export CSV, Export G-code si Export Point ISO scriu fisiere doar cu punctele.'
          },
          {
            text: 'Ctrl/Cmd+C curata toate punctele de masurare cand focusul nu este intr-un input sau in editorul de program.'
          }
        ]
      },
      {
        title: '5. UPID Path Navigator sau Program Lines',
        steps: [
          {
            text: 'Proiectele DXF folosesc UPID Path Navigator pentru ordinea contururilor, corectarea rolului de contur, directie, start, inspectie segmente, hover assist si constructii tangent/perpendicular.',
            highlightTarget: 'program-lines'
          },
          {
            text: 'Programele externe postate arata Program Lines, grupate in header, body contours si footer. Inchide grupuri ca programele mari sa ramana usor de citit.',
            highlightTarget: 'program-lines'
          },
          {
            text: 'Inchide sau redeschide Program Lines din header cand vrei mai mult spatiu pentru preview, fara sa pierzi draftul curent.',
            mock: { label: 'Close drawer' },
            highlightTarget: 'program-lines'
          },
          {
            text: 'Select mode este pentru selectie de randuri. Edit mode transforma randul intr-un editor inline si salveaza cand iesi din camp.',
            mock: { label: 'Select / Edit' },
            highlightTarget: 'line-modes'
          },
          {
            text: 'Click selecteaza un rand. Ctrl/Cmd-click selecteaza randuri separate. Shift-click selecteaza tot intervalul dintre ultimul click si clickul nou.'
          },
          {
            text: 'Contorul selected este clickabil, iar Escape curata selectia. Highlight-urile temporare dispar, dar reperele pinned raman.',
            mock: { label: '2 selected' },
            highlightTarget: 'selection-counter'
          },
          {
            text: 'Hover pe un rand si foloseste pin-ul lui ca endpoint-ul sa ramana evidentiat in preview. Pin-ul rosu curata toate reperele pinned.',
            mock: { label: 'Pin', tone: 'danger' },
            highlightTarget: 'clear-pins'
          }
        ]
      },
      {
        title: '6. Editare si export',
        steps: [
          {
            text: 'Pentru proiecte DXF, schimba ordinea operatiilor, corecteaza rolul conturului, inverseaza directia sau seteaza startul din suprafata de path. Deciziile manuale UPID sunt inregistrate in inspectorul geometriei selectate. Pentru programe externe, muta randuri, sterge randuri, undo/redo sau Start Here.'
          },
          {
            text: 'Normalize Draft rescrie textul curent in stilul ISO al aplicatiei, fara download.',
            mock: { label: 'Normalize Draft' },
            highlightTarget: 'normalize-draft'
          },
          {
            text: 'Export ISO descarca o copie ISO normalizata fara sa modifice draftul curent.',
            mock: { label: 'Export ISO' },
            highlightTarget: 'export-iso'
          },
          {
            text: 'Save Path Plan scrie deciziile DXF inapoi in proiect. Save Program scrie draftul unui program extern inapoi in workbench.',
            mock: { label: 'Save Path Plan' },
            highlightTarget: 'save-program'
          }
        ]
      }
    ]
  }
};

export function getEditorGuideCopy(language: EditorGuideLanguage): EditorGuideCopy {
  return EDITOR_GUIDE_COPY[language] ?? EDITOR_GUIDE_COPY.en;
}
