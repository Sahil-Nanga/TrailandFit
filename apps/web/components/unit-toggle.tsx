"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface UnitToggleProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}

export function UnitToggle<T extends string>({ label, options, value, onChange }: UnitToggleProps<T>) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="outline"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        // Single choice: ignore attempts to un-press the active option.
        const picked = next.find((option) => option !== value) as T | undefined;
        if (picked) onChange(picked);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option} value={option} className="min-w-12">
          {option}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
