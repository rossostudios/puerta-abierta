"use client";

import {
  cloneElement,
  createContext,
  type FocusEvent,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type MouseEvent,
  type MutableRefObject,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefCallback,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type Align = "start" | "center" | "end";
type Side = "top" | "bottom" | "left" | "right";

type HoverCardContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLElement | null>;
  openDelay: number;
  closeDelay: number;
  scheduleOpen: () => void;
  scheduleClose: () => void;
  cancelTimers: () => void;
};

const HoverCardContext = createContext<HoverCardContextValue | null>(null);

function useHoverCardContext(): HoverCardContextValue {
  const ctx = useContext(HoverCardContext);
  if (!ctx) {
    throw new Error("HoverCard components must be used within <HoverCard />");
  }
  return ctx;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(value);
        continue;
      }
      // React.RefObject<T> has a readonly current type, but refs passed in this
      // codebase are mutable refs.
      (ref as MutableRefObject<T | null>).current = value;
    }
  };
}

export function HoverCard({
  children,
  openDelay = 250,
  closeDelay = 80,
}: {
  children: ReactNode;
  openDelay?: number;
  closeDelay?: number;
}) {
  const triggerRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelTimers = useCallback(() => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    cancelTimers();
    openTimer.current = window.setTimeout(() => setOpen(true), openDelay);
  }, [cancelTimers, openDelay]);

  const scheduleClose = useCallback(() => {
    cancelTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), closeDelay);
  }, [cancelTimers, closeDelay]);

  useEffect(() => cancelTimers, [cancelTimers]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const value = useMemo<HoverCardContextValue>(
    () => ({
      open,
      setOpen,
      triggerRef,
      openDelay,
      closeDelay,
      scheduleOpen,
      scheduleClose,
      cancelTimers,
    }),
    [cancelTimers, closeDelay, open, openDelay, scheduleClose, scheduleOpen]
  );

  return (
    <HoverCardContext.Provider value={value}>
      {children}
    </HoverCardContext.Provider>
  );
}

export function HoverCardTrigger({
  asChild = false,
  children,
}: {
  asChild?: boolean;
  children: ReactNode;
}) {
  const { triggerRef, scheduleOpen, scheduleClose, cancelTimers, setOpen } =
    useHoverCardContext();
  const setTriggerEl: RefCallback<HTMLElement> = useCallback(
    (node) => {
      triggerRef.current = node;
    },
    [triggerRef]
  );

  const close = useCallback(() => {
    cancelTimers();
    setOpen(false);
  }, [cancelTimers, setOpen]);

  if (asChild) {
    if (!isValidElement(children)) {
      throw new Error(
        "HoverCardTrigger with asChild expects a single React element child."
      );
    }
    const child = children as ReactElement<{
      onBlur?: (event: FocusEvent<HTMLElement>) => void;
      onFocus?: (event: FocusEvent<HTMLElement>) => void;
      onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
      onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
      onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
    }>;
    const childProps = child.props;

    return cloneElement(child, {
      onBlur: (event: FocusEvent<HTMLElement>) => {
        childProps.onBlur?.(event);
        scheduleClose();
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        triggerRef.current = event.currentTarget;
        childProps.onFocus?.(event);
        scheduleOpen();
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        childProps.onKeyDown?.(event);
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
      },
      onMouseEnter: (event: MouseEvent<HTMLElement>) => {
        triggerRef.current = event.currentTarget;
        childProps.onMouseEnter?.(event);
        scheduleOpen();
      },
      onMouseLeave: (event: MouseEvent<HTMLElement>) => {
        childProps.onMouseLeave?.(event);
        scheduleClose();
      },
    });
  }

  return (
    <button
      onBlur={() => scheduleClose()}
      onFocus={() => scheduleOpen()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
      }}
      onMouseEnter={() => scheduleOpen()}
      onMouseLeave={() => scheduleClose()}
      ref={setTriggerEl as unknown as RefCallback<HTMLButtonElement>}
      type="button"
    >
      {children}
    </button>
  );
}

export const HoverCardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & {
    align?: Align;
    side?: Side;
    sideOffset?: number;
  }
>(
  (
    {
      className,
      align = "start",
      side = "bottom",
      sideOffset = 8,
      style,
      ...props
    },
    forwardedRef
  ) => {
    const { open, triggerRef, scheduleClose, scheduleOpen, cancelTimers } =
      useHoverCardContext();
    const localRef = useRef<HTMLDivElement | null>(null);
    const ref = mergeRefs(forwardedRef, localRef);

    const portalEl = typeof document === "undefined" ? null : document.body;
    const [position, setPosition] = useState<{
      top: number;
      left: number;
      origin: string;
    } | null>(null);

    useLayoutEffect(() => {
      if (!open) return;

      const trigger = triggerRef.current;
      const content = localRef.current;
      if (!(trigger && content)) return;

      const margin = 8;

      const compute = () => {
        const t = trigger.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let usedSide: Side = side;

        const spaceBottom = vh - t.bottom;
        const spaceTop = t.top;
        const spaceRight = vw - t.right;
        const spaceLeft = t.left;

        if (
          usedSide === "bottom" &&
          spaceBottom < c.height + sideOffset + margin &&
          spaceTop >= c.height + sideOffset + margin
        ) {
          usedSide = "top";
        } else if (
          usedSide === "top" &&
          spaceTop < c.height + sideOffset + margin &&
          spaceBottom >= c.height + sideOffset + margin
        ) {
          usedSide = "bottom";
        } else if (
          usedSide === "right" &&
          spaceRight < c.width + sideOffset + margin &&
          spaceLeft >= c.width + sideOffset + margin
        ) {
          usedSide = "left";
        } else if (
          usedSide === "left" &&
          spaceLeft < c.width + sideOffset + margin &&
          spaceRight >= c.width + sideOffset + margin
        ) {
          usedSide = "right";
        }

        const alignedLeft = (() => {
          if (align === "center") return t.left + (t.width - c.width) / 2;
          if (align === "end") return t.right - c.width;
          return t.left;
        })();

        let left = alignedLeft;
        let top = t.bottom + sideOffset;

        if (usedSide === "top") {
          top = t.top - c.height - sideOffset;
        } else if (usedSide === "bottom") {
          top = t.bottom + sideOffset;
        } else if (usedSide === "right") {
          left = t.right + sideOffset;
          top = t.top + (t.height - c.height) / 2;
        } else if (usedSide === "left") {
          left = t.left - c.width - sideOffset;
          top = t.top + (t.height - c.height) / 2;
        }

        left = Math.max(margin, Math.min(left, vw - c.width - margin));
        top = Math.max(margin, Math.min(top, vh - c.height - margin));

        const origin =
          usedSide === "top"
            ? "bottom"
            : usedSide === "bottom"
              ? "top"
              : usedSide === "left"
                ? "right"
                : "left";

        setPosition({ top, left, origin });
      };

      compute();

      let raf = 0;
      const onReposition = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(compute);
      };

      window.addEventListener("resize", onReposition);
      window.addEventListener("scroll", onReposition, true);
      return () => {
        window.removeEventListener("resize", onReposition);
        window.removeEventListener("scroll", onReposition, true);
        cancelAnimationFrame(raf);
      };
    }, [align, open, side, sideOffset, triggerRef]);

    if (!(open && portalEl)) return null;

    const body = (
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Floating surfaces need hover/focus listeners.
      <div
        className={cn(
          "z-50 w-80 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none",
          className
        )}
        onBlur={() => scheduleClose()}
        onFocus={() => {
          cancelTimers();
          scheduleOpen();
        }}
        onMouseEnter={() => {
          cancelTimers();
          scheduleOpen();
        }}
        onMouseLeave={() => scheduleClose()}
        ref={ref}
        role="dialog"
        style={{
          position: "fixed",
          top: position?.top ?? 0,
          left: position?.left ?? 0,
          transformOrigin: position?.origin ?? "top",
          ...style,
        }}
        tabIndex={-1}
        {...props}
      />
    );

    return createPortal(body, portalEl);
  }
);
HoverCardContent.displayName = "HoverCardContent";
