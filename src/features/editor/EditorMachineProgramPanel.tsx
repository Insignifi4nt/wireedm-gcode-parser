import type { ReactNode } from 'react';

import { SlidingTabs } from '@/components/ui/SlidingTabs';

export type MachineProgramTab = 'lines' | 'text' | 'summary' | 'points';

const tabs = [
  { value: 'lines', label: 'Lines' },
  { value: 'text', label: 'Text' },
  { value: 'summary', label: 'Summary' },
  { value: 'points', label: 'Points' },
] as const;

/** One working surface at a time; mounted editors retain selection and scroll state. */
export function EditorMachineProgramPanel({ activeTab, onTabChange, lines, text, inspector, collapse }: {
  activeTab: MachineProgramTab;
  onTabChange: (tab: MachineProgramTab) => void;
  lines: ReactNode;
  text: ReactNode;
  inspector: ReactNode;
  collapse: ReactNode;
}) {
  return <div className="flex h-full min-h-0 min-w-0 flex-col" data-editor-side-code-panel>
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border px-2 py-1">
      <SlidingTabs label="Machine program panels" value={activeTab} onValueChange={onTabChange}
        className="min-w-0 flex-1" tabs={tabs.map(tab => ({ ...tab,
          id: `machine-tab-${tab.value}`, controls: `machine-panel-${tab.value === 'summary' || tab.value === 'points' ? 'details' : tab.value}` }))} />
      {collapse}
    </div>
    <div id="machine-panel-lines" role="tabpanel" aria-labelledby="machine-tab-lines"
      className={`${activeTab === 'lines' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}>
      {lines}
    </div>
    <div id="machine-panel-text" role="tabpanel" aria-labelledby="machine-tab-text"
      className={`${activeTab === 'text' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}>
      {text}
    </div>
    <div id="machine-panel-details" role="tabpanel"
      aria-labelledby={`machine-tab-${activeTab === 'points' ? 'points' : 'summary'}`}
      className={`${activeTab === 'summary' || activeTab === 'points' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}>
      {inspector}
    </div>
  </div>;
}
