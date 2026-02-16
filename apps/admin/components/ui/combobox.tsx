"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import {
  ArrowDown01Icon,
  Search01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type ComboboxProps = {
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  name?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** When true, allows free-text entry via a "Use: [typed text]" option */
  allowCustom?: boolean;
  customLabel?: (text: string) => string;
};

export function Combobox({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select option",
  searchPlaceholder = "Search...",
  emptyLabel = "No options found",
  name,
  id,
  className,
  disabled = false,
  allowCustom = false,
  customLabel = (text) => `Use: "${text}"`,
}: ComboboxProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [inputText, setInputText] = useState("");

  const isControlled = value !== undefined;
  const resolvedValue = isControlled ? value : internalValue;

  const items = useMemo(() => {
    if (!allowCustom || !inputText.trim()) return options;
    const trimmed = inputText.trim();
    const lc = trimmed.toLowerCase();
    const exactMatch = options.some(
      (o) => o.value.toLowerCase() === lc || o.label.toLowerCase() === lc
    );
    if (exactMatch) return options;
    return [
      { value: trimmed, label: customLabel(trimmed) },
      ...options,
    ];
  }, [options, allowCustom, inputText, customLabel]);

  const selectedOption = useMemo(() => {
    return items.find((option) => option.value === resolvedValue) ?? null;
  }, [items, resolvedValue]);

  function update(next: string) {
    if (!isControlled) {
      setInternalValue(next);
    }
    onValueChange?.(next);
  }

  const displayLabel = useMemo(() => {
    if (selectedOption) return selectedOption.label;
    if (allowCustom && resolvedValue) return resolvedValue;
    return null;
  }, [selectedOption, allowCustom, resolvedValue]);

  return (
    <>
      {name ? <input name={name} type="hidden" value={resolvedValue} /> : null}
      <BaseCombobox.Root<ComboboxOption>
        autoHighlight
        disabled={disabled}
        items={items}
        itemToStringLabel={(item) => item?.label ?? ""}
        itemToStringValue={(item) => item?.value ?? ""}
        onInputValueChange={(val) => setInputText(val ?? "")}
        onValueChange={(next) => update(next?.value ?? "")}
        value={selectedOption}
      >
        <BaseCombobox.Trigger
          className={cn(
            "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-left text-sm shadow-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            displayLabel ? "text-foreground" : "text-muted-foreground",
            className
          )}
          id={id}
        >
          <BaseCombobox.Value placeholder={placeholder}>
            {() => displayLabel ?? placeholder}
          </BaseCombobox.Value>
          <Icon
            className="text-muted-foreground"
            icon={ArrowDown01Icon}
            size={15}
          />
        </BaseCombobox.Trigger>

        <BaseCombobox.Portal>
          <BaseCombobox.Positioner
            align="start"
            collisionPadding={8}
            side="bottom"
            sideOffset={8}
          >
            <BaseCombobox.Popup
              className={(state) =>
                cn(
                  "z-50 w-[min(92vw,20rem)] rounded-xl border border-border/80 bg-popover p-2 text-popover-foreground shadow-xl",
                  "transition-[opacity,transform] duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  state.open
                    ? "translate-y-0 opacity-100"
                    : "translate-y-1 opacity-0"
                )
              }
            >
              <div className="flex items-center gap-2 rounded-md border border-input px-2">
                <Icon
                  className="text-muted-foreground"
                  icon={Search01Icon}
                  size={14}
                />
                <BaseCombobox.Input
                  className="h-8 w-full border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  placeholder={searchPlaceholder}
                />
              </div>

              <BaseCombobox.List className="mt-2 max-h-60 space-y-0.5 overflow-y-auto pr-1">
                {(item: ComboboxOption) => (
                  <BaseCombobox.Item
                    className={(state) =>
                      cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        state.highlighted
                          ? "bg-muted text-foreground"
                          : "text-foreground/88",
                        state.selected ? "font-medium" : ""
                      )
                    }
                    key={item.value}
                    value={item}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.description ? (
                        <span className="block truncate text-muted-foreground text-xs">
                          {item.description}
                        </span>
                      ) : null}
                    </span>

                    <BaseCombobox.ItemIndicator>
                      <Icon
                        className="text-foreground"
                        icon={Tick01Icon}
                        size={14}
                      />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>

              {allowCustom ? null : (
                <BaseCombobox.Empty className="px-2 py-3 text-muted-foreground text-sm">
                  {emptyLabel}
                </BaseCombobox.Empty>
              )}
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
    </>
  );
}
