import { useEffect, useMemo, useState } from 'react';

import {
  projectMachineProfileDraft,
  updateProjectMachineProfile,
  type ProjectMachineProfileDraft,
  type ProjectMachineProfileDraftField
} from '@/domain/machine/updateProjectMachineProfile';
import type { WorkbenchProject } from '@/domain/workbench/types';

interface EditorProjectMachinePanelProps {
  disabled: boolean;
  onDraftChange?: () => void;
  onUpdateProject: (project: WorkbenchProject) => void;
  project: WorkbenchProject;
}

export function EditorProjectMachinePanel({
  disabled,
  onDraftChange,
  onUpdateProject,
  project
}: EditorProjectMachinePanelProps) {
  const sourceKey = useMemo(() => JSON.stringify(project.machine), [project.machine]);
  const [draft, setDraft] = useState<ProjectMachineProfileDraft>(
    () => projectMachineProfileDraft(project.machine)
  );
  const [errors, setErrors] = useState<
    Partial<Record<ProjectMachineProfileDraftField, string>>
  >({});

  useEffect(() => {
    setDraft(projectMachineProfileDraft(project.machine));
    setErrors({});
  }, [sourceKey, project.machine]);

  function updateField(field: ProjectMachineProfileDraftField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    onDraftChange?.();
  }

  function reviewAndVerify() {
    if (disabled) return;
    const result = updateProjectMachineProfile(project, draft, {
      reviewedAt: new Date()
    });
    if (!result.ok) {
      setErrors(result.errors);
      onDraftChange?.();
      return;
    }
    setErrors({});
    onUpdateProject(result.project);
  }

  return (
    <section className="grid gap-2 text-[10px]" data-editor-project-machine-panel>
      <div className="border border-border bg-background/35 p-2">
        <div className="truncate font-medium" title={project.machine.name}>
          {project.machine.name}
        </div>
        <div className="mt-1 flex justify-between gap-2 text-muted-foreground">
          <span>Project snapshot</span>
          <span data-editor-machine-verification>
            {project.machine.controller.verification.status === 'user-verified'
              ? 'Reviewed'
              : 'Review required'}
          </span>
        </div>
      </div>

      <fieldset className="grid gap-2 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Generated transitions</legend>
        <MachineNumberField
          error={errors.validationLeadLengthMm}
          label="Validation lead (mm)"
          inputLabel="Compensation validation lead length"
          onChange={(value) => updateField('validationLeadLengthMm', value)}
          value={draft.validationLeadLengthMm}
        />
        <MachineNumberField
          error={errors.coordinatePrecision}
          label="Coordinate precision (0–6)"
          inputLabel="Output coordinate precision"
          onChange={(value) => updateField('coordinatePrecision', value)}
          value={draft.coordinatePrecision}
        />
      </fieldset>

      <fieldset className="grid gap-2 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Work area (mm)</legend>
        <div className="grid grid-cols-2 gap-1">
          <MachineNumberField
            error={errors.workAreaWidthMm}
            label="Width"
            inputLabel="Work-area width"
            onChange={(value) => updateField('workAreaWidthMm', value)}
            value={draft.workAreaWidthMm}
          />
          <MachineNumberField
            error={errors.workAreaLengthMm}
            label="Length"
            inputLabel="Work-area length"
            onChange={(value) => updateField('workAreaLengthMm', value)}
            value={draft.workAreaLengthMm}
          />
        </div>
        <p className="leading-4 text-muted-foreground">
          Leave a dimension blank when that machine limit is not configured.
        </p>
      </fieldset>

      <button
        aria-label="Review and verify project machine settings"
        className="h-7 border border-emerald-600/70 bg-emerald-500/10 px-2 text-emerald-200 disabled:opacity-40"
        disabled={disabled}
        onClick={reviewAndVerify}
        type="button"
      >
        Review &amp; verify settings
      </button>
      <p className="leading-4 text-muted-foreground">
        Applies only to this project snapshot. Review confirms the current controller and output
        settings for posting.
      </p>
    </section>
  );
}

function MachineNumberField({
  error,
  inputLabel,
  label,
  onChange,
  value
}: {
  error?: string;
  inputLabel: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid min-w-0 gap-0.5 text-muted-foreground">
      <span>{label}</span>
      <input
        aria-label={inputLabel}
        aria-invalid={error ? 'true' : undefined}
        className="h-7 min-w-0 border border-border bg-background px-1.5 font-mono text-foreground"
        inputMode="decimal"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
      {error && <span className="leading-4 text-destructive">{error}</span>}
    </label>
  );
}
