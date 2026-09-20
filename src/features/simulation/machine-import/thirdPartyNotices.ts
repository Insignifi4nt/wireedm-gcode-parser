import importerLicense from './notices/occt-import-js-LGPL-2.1.txt?url';
import occtLicense from './notices/OCCT-LGPL-2.1.txt?url';
import occtException from './notices/OCCT-LGPL-exception.txt?url';

/** These local license assets must remain linked wherever STEP import is exposed. */
export const MACHINE_IMPORT_THIRD_PARTY = Object.freeze({
  notice: 'STEP import uses occt-import-js 0.0.23 and Open CASCADE Technology, licensed under GNU LGPL 2.1; Open CASCADE includes its additional exception. These libraries are provided without warranty.',
  links: [
    { label: 'occt-import-js LGPL 2.1', href: importerLicense },
    { label: 'Open CASCADE LGPL 2.1', href: occtLicense },
    { label: 'Open CASCADE exception', href: occtException },
    { label: 'occt-import-js source', href: 'https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2' },
    { label: 'Open CASCADE source', href: 'https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5' }
  ]
});
