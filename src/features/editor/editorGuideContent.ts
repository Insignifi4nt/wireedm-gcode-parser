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
  | 'normalize-draft';

export interface EditorGuideStep {
  text: string;
  context?: 'path' | 'program';
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
            text: 'The app opens a local workbench automatically. The header identifies Browser cache, Folder, or Temporary storage. Export portable projects to keep a separate copy; clearing browser data removes the cached library.'
          },
          {
            text: 'Settings can connect a workbench folder or return to Browser cache. They are separate libraries; switching storage does not copy projects.'
          },
          {
            text: 'Machine identity, work-area limits, and active setups come from installed machine packages. Controller-file rules such as extension and line endings come from the exact post processor in that setup.'
          }
        ]
      },
      {
        title: '2. Import Flows',
        steps: [
          {
            text: 'From the dashboard, import a DXF to create a clean internal path project. A controller artifact is generated later from a saved revision and the active setup of the planned machine.'
          },
          {
            text: 'From the editor, click Import Program to choose a .gcode, .nc, .iso, or .txt file. External programs pass through the cleanup/display pipeline before canvas display and editing.',
            context: 'program',
            mock: { label: 'Import Program', tone: 'primary' },
            highlightTarget: 'import-program'
          },
          {
            text: 'DXF and UPID projects open with Program and Geometry lenses in the left rail. External posted programs use Program Lines and the text editor.'
          }
        ]
      },
      {
        title: '3. Canvas Navigation',
        steps: [
          {
            text: 'The canvas shows rapid and cut moves, start/end markers, selected rows, hovered rows, pinned references, measurement points, the grid, and axes.',
            highlightTarget: 'preview'
          },
          {
            text: 'Use the canvas toolbar, Ctrl/Cmd +/- shortcuts, mouse wheel, or Fit to Screen to zoom. Shift-drag or middle-drag pans the view.'
          },
          {
            text: 'Press G to toggle grid visibility. The status bar shows live cursor coordinates over the canvas.'
          },
          {
            text: 'Open Construction points and enable Grid Snap to place points on the 5-unit canvas grid. The control identifies the preview units; an undeclared program has no assumed physical scale.',
            mock: { label: 'Grid Snap ON' },
            highlightTarget: 'grid-snap'
          }
        ]
      },
      {
        title: '4. Measure and construction points',
        steps: [
          {
            text: 'Open Construction > Measure and pick A and B. Magnetic snapping identifies endpoints, midpoints, centers and edges. Point distance measures those picks; Minimum feature gap measures the nearest edges of their source features. Center distance appears for circular features. These inspections do not change the project.',
            context: 'path'
          },
          {
            text: 'Choose Chain or Keep first point for repeated measurements. Inspect A or B shows that feature’s dimensions while preserving the measured pair. Minimum feature gap uses source geometry before compensation.',
            context: 'path'
          },
          {
            text: 'Open Construction > Construction points, then use Point mode to place P1, P2, and later points. You can also type exact X/Y values and click Add Point.',
            highlightTarget: 'measurement-points'
          },
          {
            text: 'Delete individual points from the list, or use Clear Points to empty the list. Remaining points are reindexed automatically.'
          },
          {
            text: 'Construction points are saved coordinate snapshots. Magnetic references record how points were placed; they are not persistent geometric constraints. Export CSV writes the coordinates for outside use.'
          },
          {
            text: 'Insert Points writes construction coordinates into an external program using its active units and positioning mode. Review the resulting moves before saving.',
            context: 'program'
          },
          {
            text: 'While Construction points is open, Alt/Option+Shift+C clears all points when focus is not inside an input.'
          }
        ]
      },
      {
        title: '5. UPID Path Navigator Or Program Lines',
        steps: [
          {
            text: 'Use the Program lens to inspect execution and open the matching workflow. The Geometry lens selects source contours and segments. Cut Sequence controls order; Contour Setup controls direction and kept material; Contour Start sets a closed contour’s start.',
            context: 'path'
          },
          {
            text: 'Review Initial wire position, Entry / Exit, and Between Contours before export. Machining Participation keeps excluded source geometry visible. Program Stops places explicit stop events. Diagnostics links issues to the affected geometry.',
            context: 'path'
          },
          {
            text: 'External posted programs show Program Lines, grouped into header, body contours, and footer. Collapse groups to keep large programs readable.',
            context: 'program',
            highlightTarget: 'program-lines'
          },
          {
            text: 'Close or reopen Program Lines from its header when you need more room for the canvas without losing the current draft.',
            context: 'program',
            mock: { label: 'Close drawer' },
            highlightTarget: 'program-lines'
          },
          {
            text: 'Select mode is for row selection. Edit mode changes the row into an inline editor and commits on blur.',
            context: 'program',
            mock: { label: 'Select / Edit' },
            highlightTarget: 'line-modes'
          },
          {
            text: 'Click selects a row. Ctrl/Cmd-click toggles unrelated rows. Shift-click selects every row between the last click and the new click.',
            context: 'program'
          },
          {
            text: 'The selected counter is clickable and Escape clears selection. This removes temporary canvas highlights without touching pinned reference points.',
            context: 'program',
            mock: { label: '2 selected' },
            highlightTarget: 'selection-counter'
          },
          {
            text: 'Hover a row and use its pin button to keep that endpoint highlighted on the canvas. The red pin button clears all pinned references.',
            context: 'program',
            mock: { label: 'Pin', tone: 'danger' },
            highlightTarget: 'clear-pins'
          }
        ]
      },
      {
        title: '6. Editing And Export',
        steps: [
          {
            text: 'Workflow Save commits one undoable change; Cancel restores the opening state after you discard pending changes. Switching workflows with edits asks you to save or discard. Header Save persists committed decisions to the project.',
            context: 'path'
          },
          {
            text: 'Controller Export uses a saved revision and the chosen machine’s active setup. Save the project first, repair blocking diagnostics, then review and download the exact output. Source geometry checks do not simulate stock, fixtures, or machine motion.',
            context: 'path'
          },
          {
            text: 'Move or delete selected program rows, change a contour start with Start Here, or edit Program Text. Undo and Redo restore text, selection and pins. Replacing Program Text clears line references that cannot be mapped reliably.',
            context: 'program'
          },
          {
            text: 'Normalize Draft rewrites the current editor text into the app ISO style without downloading a file.',
            context: 'program',
            mock: { label: 'Normalize Draft' },
            highlightTarget: 'normalize-draft'
          },
          {
            text: 'Export normalized ISO in the header downloads a normalized copy without mutating the current draft.',
            context: 'program',
            mock: { label: 'Export normalized ISO' }
          },
          {
            text: 'Save in the header is the single persistence control. It writes committed DXF workflow decisions back to the project or a Machine Program draft back to the active workbench entry.',
            context: 'program',
            mock: { label: 'Header Save' }
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
            text: 'Aplicatia deschide automat un workbench local. Bara de sus identifica Browser cache, Folder sau Temporary storage. Exporta proiectele portabile pentru o copie separata; stergerea datelor browserului elimina biblioteca din cache.'
          },
          {
            text: 'Settings poate conecta un folder workbench sau reveni la Browser cache. Sunt biblioteci separate; schimbarea stocarii nu copiaza proiectele.'
          },
          {
            text: 'Identitatea masinii, limitele zonei de lucru si setup-urile active vin din machine package-urile instalate. Regulile fisierului controller, precum extensia si line ending-ul, vin din post-processorul exact al setup-ului.'
          }
        ]
      },
      {
        title: '2. Flow-uri de import',
        steps: [
          {
            text: 'Din dashboard, importa un DXF ca sa creezi un proiect intern de path. Artifactul pentru controller este generat ulterior dintr-o revizie salvata si setup-ul activ al masinii planificate.'
          },
          {
            text: 'Din editor, apasa Import Program pentru a alege un fisier .gcode, .nc, .iso ori .txt. Programele externe trec prin pipeline-ul de cleanup/display inainte de afisare pe canvas si editare.',
            context: 'program',
            mock: { label: 'Import Program', tone: 'primary' },
            highlightTarget: 'import-program'
          },
          {
            text: 'Proiectele DXF si UPID au lentilele Program si Geometry in bara din stanga. Programele externe folosesc Program Lines si editorul de text.'
          }
        ]
      },
      {
        title: '3. Navigare canvas',
        steps: [
          {
            text: 'Canvas-ul arata miscari rapide si de taiere, markere start/end, randuri selectate, randuri hover, repere pinned, puncte de masurare, grid si axe.',
            highlightTarget: 'preview'
          },
          {
            text: 'Foloseste toolbar-ul canvasului, shortcut-uri Ctrl/Cmd +/-, rotita mouse-ului sau Fit to Screen pentru zoom. Shift-drag sau middle-drag face pan.'
          },
          {
            text: 'Apasa G ca sa ascunzi sau afisezi gridul. Bara de stare arata coordonatele live ale cursorului pe canvas.'
          },
          {
            text: 'Deschide Construction points si activeaza Grid Snap pentru gridul de 5 unitati. Controlul indica unitatile previzualizarii; un program fara unitati declarate nu are o scara fizica presupusa.',
            mock: { label: 'Grid Snap ON' },
            highlightTarget: 'grid-snap'
          }
        ]
      },
      {
        title: '4. Masurare si puncte de constructie',
        steps: [
          {
            text: 'Deschide Construction > Measure si alege A si B. Snapping-ul magnetic identifica capete, mijloace, centre si muchii. Point distance masoara punctele alese; Minimum feature gap masoara distanta minima dintre geometriile sursa. Center distance apare pentru geometrii circulare. Inspectia nu modifica proiectul.',
            context: 'path'
          },
          {
            text: 'Alege Chain sau Keep first point pentru masurari repetate. Inspect A sau B arata dimensiunile geometriei fara sa inlocuiasca perechea masurata. Minimum feature gap foloseste geometria sursa inainte de compensare.',
            context: 'path'
          },
          {
            text: 'Deschide Construction > Construction points, apoi foloseste modul Point pentru P1, P2 si punctele urmatoare. Poti introduce si valori exacte X/Y, apoi Add Point.',
            highlightTarget: 'measurement-points'
          },
          {
            text: 'Sterge puncte individual din lista sau foloseste Clear Points pentru lista goala. Punctele ramase se reindexeaza automat.'
          },
          {
            text: 'Punctele de constructie sunt coordonate salvate. Referintele magnetice retin metoda de plasare, fara constrangeri geometrice permanente. Export CSV scrie coordonatele pentru utilizare externa.'
          },
          {
            text: 'Insert Points scrie coordonatele in programul extern folosind unitatile si modul de pozitionare active. Verifica miscarile rezultate inainte de salvare.',
            context: 'program'
          },
          {
            text: 'Cat timp Construction points este deschis, Alt/Option+Shift+C curata toate punctele cand focusul nu este intr-un input.'
          }
        ]
      },
      {
        title: '5. UPID Path Navigator sau Program Lines',
        steps: [
          {
            text: 'Lentila Program arata executia si deschide workflow-ul potrivit. Geometry selecteaza contururi si segmente sursa. Cut Sequence controleaza ordinea; Contour Setup controleaza directia si materialul pastrat; Contour Start stabileste startul unui contur inchis.',
            context: 'path'
          },
          {
            text: 'Verifica Initial wire position, Entry / Exit si Between Contours inainte de export. Machining Participation pastreaza vizibila geometria exclusa. Program Stops plaseaza opriri explicite. Diagnostics leaga problemele de geometria afectata.',
            context: 'path'
          },
          {
            text: 'Programele externe postate arata Program Lines, grupate in header, body contours si footer. Inchide grupuri ca programele mari sa ramana usor de citit.',
            context: 'program',
            highlightTarget: 'program-lines'
          },
          {
            text: 'Inchide sau redeschide Program Lines din header cand vrei mai mult spatiu pentru canvas, fara sa pierzi draftul curent.',
            context: 'program',
            mock: { label: 'Close drawer' },
            highlightTarget: 'program-lines'
          },
          {
            text: 'Select mode este pentru selectie de randuri. Edit mode transforma randul intr-un editor inline si salveaza cand iesi din camp.',
            context: 'program',
            mock: { label: 'Select / Edit' },
            highlightTarget: 'line-modes'
          },
          {
            text: 'Click selecteaza un rand. Ctrl/Cmd-click selecteaza randuri separate. Shift-click selecteaza tot intervalul dintre ultimul click si clickul nou.',
            context: 'program'
          },
          {
            text: 'Contorul selected este clickabil, iar Escape curata selectia. Highlight-urile temporare dispar, dar reperele pinned raman.',
            context: 'program',
            mock: { label: '2 selected' },
            highlightTarget: 'selection-counter'
          },
          {
            text: 'Hover pe un rand si foloseste pin-ul lui ca endpoint-ul sa ramana evidentiat pe canvas. Pin-ul rosu curata toate reperele pinned.',
            context: 'program',
            mock: { label: 'Pin', tone: 'danger' },
            highlightTarget: 'clear-pins'
          }
        ]
      },
      {
        title: '6. Editare si export',
        steps: [
          {
            text: 'Save din workflow confirma o singura modificare anulabila prin Undo. Cancel restaureaza starea de la deschidere dupa Discard. Schimbarea workflow-ului cu modificari cere Save sau Discard. Save din header persista deciziile confirmate in proiect.',
            context: 'path'
          },
          {
            text: 'Controller Export foloseste o revizie salvata si setup-ul activ al masinii alese. Salveaza proiectul, rezolva diagnosticele blocante, apoi verifica si descarca iesirea exacta. Verificarile geometriei sursa nu simuleaza materialul, dispozitivele de fixare sau miscarea masinii.',
            context: 'path'
          },
          {
            text: 'Muta sau sterge randuri, schimba startul cu Start Here ori editeaza Program Text. Undo si Redo restaureaza textul, selectia si pin-urile. Inlocuirea Program Text elimina referintele de rand care nu pot fi remapate sigur.',
            context: 'program'
          },
          {
            text: 'Normalize Draft rescrie textul curent in stilul ISO al aplicatiei, fara download.',
            context: 'program',
            mock: { label: 'Normalize Draft' },
            highlightTarget: 'normalize-draft'
          },
          {
            text: 'Export normalized ISO din header descarca o copie normalizata fara sa modifice draftul curent.',
            context: 'program',
            mock: { label: 'Export normalized ISO' }
          },
          {
            text: 'Save din header este singurul control de persistenta. El scrie deciziile DXF confirmate inapoi in proiect sau draftul unui Machine Program inapoi in workbench.',
            context: 'program',
            mock: { label: 'Header Save' }
          }
        ]
      }
    ]
  }
};

export function getEditorGuideCopy(language: EditorGuideLanguage, context: 'path' | 'program' = 'program'): EditorGuideCopy {
  const copy = EDITOR_GUIDE_COPY[language];
  return {
    ...copy,
    sections: copy.sections.map(section => ({
      ...section,
      steps: section.steps.filter(step => !step.context || step.context === context)
    }))
  };
}
