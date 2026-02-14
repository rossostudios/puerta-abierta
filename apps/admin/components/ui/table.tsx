import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        className={cn("w-full caption-bottom text-sm", className)}
        ref={ref}
        {...props}
      />
    </div>
  )
);
Table.displayName = "Table";

const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    className={cn(
      "bg-muted/35 [&_tr]:border-border/75 [&_tr]:border-b",
      className
    )}
    ref={ref}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    className={cn("[&_tr:last-child]:border-0", className)}
    ref={ref}
    {...props}
  />
));
TableBody.displayName = "TableBody";

const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    className={cn(
      "border-t bg-muted/30 text-xs text-muted-foreground",
      className
    )}
    ref={ref}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = forwardRef<
  HTMLTableRowElement,
  HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    className={cn(
      "border-border/40 border-b transition-colors hover:bg-muted/34 data-[state=selected]:bg-muted/45",
      className
    )}
    ref={ref}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement> & { grid?: boolean }
>(({ className, grid, ...props }, ref) => (
  <th
    className={cn(
      "h-10 px-3 text-left align-middle font-medium text-xs text-muted-foreground",
      grid && "border-r border-border/40 last:border-r-0",
      className
    )}
    ref={ref}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement> & { grid?: boolean }
>(({ className, grid, ...props }, ref) => (
  <td
    className={cn(
      "px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0",
      grid && "border-r border-border/40 last:border-r-0",
      className
    )}
    ref={ref}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    className={cn("mt-4 text-muted-foreground text-sm", className)}
    ref={ref}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
