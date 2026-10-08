"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** A 28px select for dense rows. */
export function CompactSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
  className,
  placeholder,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string }>;
  label: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <SelectTrigger size="sm" aria-label={label} className={cn("w-full px-2 text-sm data-[size=sm]:h-7", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} className="text-sm">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
