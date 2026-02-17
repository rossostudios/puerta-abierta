"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useGuest } from "../layout";

interface ItineraryData {
  reservation: Record<string, unknown>;
  guest: Record<string, unknown> | null;
  unit: Record<string, unknown> | null;
  property: Record<string, unknown> | null;
}

function asText(obj: Record<string, unknown> | null | undefined, key: string): string {
  if (!obj) return "";
  const v = obj[key];
  return typeof v === "string" ? v.trim() : "";
}

export function GuestItinerary() {
  const { token, headers, apiBase } = useGuest();
  const [data, setData] = useState<ItineraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${apiBase}/guest/itinerary`, { headers });
        if (!res.ok) throw new Error("Failed to load itinerary");
        const json = await res.json();
        setData(json);
      } catch {
        setError("Could not load itinerary.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [apiBase, headers]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-red-600">{error || "No data available."}</p>;
  }

  const res = data.reservation;
  const guestName = asText(data.guest, "full_name");
  const propertyName = asText(data.property, "name");
  const unitName = asText(data.unit, "name");
  const checkIn = asText(res, "check_in_date");
  const checkOut = asText(res, "check_out_date");
  const status = asText(res, "status");
  const adults = res.adults ?? 1;
  const children = res.children ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {guestName ? `Welcome, ${guestName}` : "Your Itinerary"}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {propertyName}
          {unitName ? ` — ${unitName}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reservation Details</CardTitle>
          <CardDescription>
            Status:{" "}
            <span className="font-medium capitalize">{status}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Check-in</span>
            <p className="font-medium">{checkIn || "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Check-out</span>
            <p className="font-medium">{checkOut || "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Guests</span>
            <p className="font-medium">
              {String(adults)} adult{Number(adults) !== 1 ? "s" : ""}
              {Number(children) > 0
                ? `, ${String(children)} child${Number(children) !== 1 ? "ren" : ""}`
                : ""}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Property</span>
            <p className="font-medium">{propertyName || "—"}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={`/guest/${encodeURIComponent(token)}/checkin`}>
          <Button className="w-full" variant="outline">
            Check-in Info
          </Button>
        </Link>
        <Link href={`/guest/${encodeURIComponent(token)}/messages`}>
          <Button className="w-full" variant="outline">
            Messages
          </Button>
        </Link>
      </div>
    </div>
  );
}
