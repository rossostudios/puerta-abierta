"use client";

import { LayoutGridIcon } from "@hugeicons/core-free-icons";
import { createContext, useCallback, useMemo, useState } from "react";
import { RecordDetailsCard } from "@/components/module-record/record-details-card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";

export type UnitDetailsPanelProps = {
    record: Record<string, unknown>;
    keys: string[];
    locale: "en-US" | "es-PY";
    isEn: boolean;
    links: Record<string, unknown>[];
    title: string;
};

const UnitDetailsCtx = createContext<{
    open: boolean;
    toggle: (next: boolean) => void;
}>({ open: false, toggle: () => { } });

export function UnitDetailsProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const toggle = useCallback((next: boolean) => setOpen(next), []);
    const value = useMemo(() => ({ open, toggle }), [open, toggle]);
    return (
        <UnitDetailsCtx.Provider value={value}>
            {children}
        </UnitDetailsCtx.Provider>
    );
}

export function UnitDetailsTrigger({
    isEn,
    fieldCount,
    className,
}: {
    isEn: boolean;
    fieldCount: number;
    className?: string;
}) {
    return (
        <UnitDetailsCtx.Consumer>
            {({ toggle }) => (
                <Button
                    className={className}
                    onClick={() => toggle(true)}
                    size="sm"
                    variant="secondary"
                >
                    <Icon className="mr-2" icon={LayoutGridIcon} size={15} />
                    {isEn ? `View details (${fieldCount})` : `Ver detalles (${fieldCount})`}
                </Button>
            )}
        </UnitDetailsCtx.Consumer>
    );
}

export function UnitDetailsPanel({
    record,
    keys,
    locale,
    isEn,
    links,
    title,
}: UnitDetailsPanelProps) {
    return (
        <UnitDetailsCtx.Consumer>
            {({ open, toggle }) => (
                <Sheet
                    description={
                        isEn
                            ? `${keys.length} fields · record details`
                            : `${keys.length} campos · detalles del registro`
                    }
                    onOpenChange={toggle}
                    open={open}
                    side="right"
                    title={title}
                >
                    <div className="space-y-6">
                        <RecordDetailsCard
                            isEn={isEn}
                            keys={keys}
                            locale={locale}
                            record={record}
                        />

                        {links.length > 0 ? (
                            <div className="space-y-4">
                                <h3 className="font-semibold text-foreground text-sm">
                                    {isEn ? "Related Records" : "Registros Relacionados"}
                                </h3>
                                {links.map((link) => (
                                    <div
                                        className="flex flex-col gap-1 rounded-xl border border-border/80 bg-muted/20 p-4"
                                        key={String(link.href)}
                                    >
                                        <a
                                            className="font-medium text-primary text-sm hover:underline"
                                            href={String(link.href)}
                                        >
                                            {String(link.label)}
                                        </a>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </Sheet>
            )}
        </UnitDetailsCtx.Consumer>
    );
}
