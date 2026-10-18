import { SlidersHorizontal } from '@wire-edm/icons-react';
import { Button } from '@/components/ui/button';
import { MenuLabel, MenuRadioItem, MenuSeparator, MenuSurface } from '@/components/ui/menu';
import type { ProjectSortMode, ProjectSourceFilter, ProjectStateFilter } from './dashboardProjects';
import { useDashboardMenu } from './useDashboardMenu';

const states = [
  { value: 'active', label: 'Active projects' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All projects' }
] satisfies readonly { value: ProjectStateFilter; label: string }[];
const sources = [
  { value: 'all', label: 'All sources' }, { value: 'cad', label: 'CAD projects' },
  { value: 'dxf', label: 'Path projects' }, { value: 'external-gcode', label: 'Machine programs' }
] satisfies readonly { value: ProjectSourceFilter; label: string }[];
const orders = [
  { value: 'updated-desc', label: 'Newest first' }, { value: 'updated-asc', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A–Z' }, { value: 'name-desc', label: 'Name Z–A' }, { value: 'type', label: 'Type' }
] satisfies readonly { value: ProjectSortMode; label: string }[];

export function ProjectFilters({ state, source, sort, disabled, onStateChange, onSourceChange, onSortChange }: {
  state: ProjectStateFilter; source: ProjectSourceFilter; sort: ProjectSortMode; disabled: boolean;
  onStateChange(value: ProjectStateFilter): void;
  onSourceChange(value: ProjectSourceFilter): void;
  onSortChange(value: ProjectSortMode): void;
}) {
  const menu = useDashboardMenu(disabled);
  const open = !disabled && menu.openId !== null;
  const count = Number(state !== 'active') + Number(source !== 'all') + Number(sort !== 'updated-desc');
  const summary = [states.find(option => option.value === state)?.label, sources.find(option => option.value === source)?.label,
    orders.find(option => option.value === sort)?.label].join(' · ');
  return <div className="dashboard-filter">
    <Button ref={menu.triggerRef} aria-label="Filter projects" aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? menu.menuId : undefined} disabled={disabled} title={summary}
      onClick={() => menu.toggle('filters')} onKeyDown={event => menu.onTriggerKeyDown(event, 'filters')} type="button">
      <SlidersHorizontal /> Filter{count > 0 && <span className="dashboard-filter-count" aria-hidden="true">{count}</span>}
    </Button>
    {open && <MenuSurface ref={menu.menuRef} id={menu.menuId} aria-label="Project filters and sorting"
      className="dashboard-filter-menu" onKeyDown={menu.onMenuKeyDown}>
      <div role="group" aria-label="Project state filter"><MenuLabel>Show</MenuLabel>
        {states.map(option => <MenuRadioItem key={option.value} value={option.value} checked={state === option.value}
          onSelect={() => onStateChange(option.value)}>{option.label}</MenuRadioItem>)}
      </div>
      <MenuSeparator />
      <div role="group" aria-label="Project source filter"><MenuLabel>Source</MenuLabel>
        {sources.map(option => <MenuRadioItem key={option.value} value={option.value} checked={source === option.value}
          onSelect={() => onSourceChange(option.value)}>{option.label}</MenuRadioItem>)}
      </div>
      <MenuSeparator />
      <div role="group" aria-label="Project sort"><MenuLabel>Sort</MenuLabel>
        {orders.map(option => <MenuRadioItem key={option.value} value={option.value} checked={sort === option.value}
          onSelect={() => onSortChange(option.value)}>{option.label}</MenuRadioItem>)}
      </div>
    </MenuSurface>}
  </div>;
}
