"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { onApiError } from "@/lib/api-client";

/**
 * Listens for global API error events and shows toast notifications.
 * Mount once in the root layout.
 */
export function ApiErrorToaster() {
  useEffect(() => {
    return onApiError(({ status, message, retryable }) => {
      if (status === 403) {
        toast.error("Access denied", { description: message });
      } else if (retryable) {
        toast.error("Backend temporarily unavailable", {
          description:
            "Please retry in a moment. We are automatically backing off.",
        });
      } else if (status >= 500) {
        toast.error("Server error", {
          description:
            "Something went wrong on the server. Please try again in a moment.",
        });
      } else {
        toast.error("Request failed", {
          description: message.slice(0, 200),
        });
      }
    });
  }, []);

  return null;
}
