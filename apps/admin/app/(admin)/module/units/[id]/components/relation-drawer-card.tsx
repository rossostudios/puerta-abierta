"use client";

import { ArrowRight01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";

export function RelationDrawerCard({
    label,
    slug,
    isEn,
    children,
}: {
    label: string;
    slug: string;
    isEn: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center justify-between p-4 rounded-2xl border border-border/40 bg-card hover:bg-muted/50 hover:shadow-[var(--shadow-floating)] transition-all text-left group"
            >
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center p-2 rounded-xl bg-primary/5 text-primary">
                        <Icon icon={Folder01Icon} size={20} />
                    </div>
                    <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                        {label}
                    </span>
                </div>
                <Icon
                    icon={ArrowRight01Icon}
                    size={16}
                    className="text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all"
                />
            </button>

            <Sheet
                open={open}
                onOpenChange={setOpen}
                title={
                    <div className="flex items-center gap-3">
                        <Badge variant="outline" className="uppercase tracking-widest text-[10px]">
                            {slug}
                        </Badge>
                        <span>{label}</span>
                    </div>
                }
                description={isEn ? "View and manage related records." : "Ver y administrar registros relacionados."}
            >
                {children}
            </Sheet>
        </>
    );
}
