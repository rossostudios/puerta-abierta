"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useGuest } from "../layout";

interface CheckinData {
  check_in_date: string | null;
  check_out_date: string | null;
  status: string | null;
  property_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_lat: number | null;
  property_lng: number | null;
  unit_name: string | null;
  wifi_network: string | null;
  wifi_password: string | null;
  check_in_instructions: string | null;
  house_rules: string | null;
  emergency_contact: string | null;
}

export function CheckinInfo() {
  const { token, headers, apiBase } = useGuest();
  const [data, setData] = useState<CheckinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${apiBase}/guest/checkin-info`, { headers });
        if (!res.ok) throw new Error("Failed to load check-in info");
        const json = await res.json();
        setData(json);
      } catch {
        setError("Could not load check-in information.");
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

  const hasMap = data.property_lat && data.property_lng;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Check-in Information</h1>
        <Link href={`/guest/${encodeURIComponent(token)}/itinerary`}>
          <Button size="sm" variant="outline">
            Back
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {data.property_name || "Property"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Check-in</span>
              <p className="font-medium">{data.check_in_date || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Check-out</span>
              <p className="font-medium">{data.check_out_date || "—"}</p>
            </div>
          </div>

          {data.property_address && (
            <div>
              <span className="text-muted-foreground">Address</span>
              <p className="font-medium">
                {data.property_address}
                {data.property_city ? `, ${data.property_city}` : ""}
              </p>
            </div>
          )}

          {data.unit_name && (
            <div>
              <span className="text-muted-foreground">Unit</span>
              <p className="font-medium">{data.unit_name}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {data.check_in_instructions && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Check-in Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">
              {data.check_in_instructions}
            </p>
          </CardContent>
        </Card>
      )}

      {(data.wifi_network || data.wifi_password) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">WiFi</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            {data.wifi_network && (
              <div>
                <span className="text-muted-foreground">Network</span>
                <p className="font-mono font-medium">{data.wifi_network}</p>
              </div>
            )}
            {data.wifi_password && (
              <div>
                <span className="text-muted-foreground">Password</span>
                <p className="font-mono font-medium">{data.wifi_password}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.house_rules && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">House Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{data.house_rules}</p>
          </CardContent>
        </Card>
      )}

      {data.emergency_contact && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Emergency Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{data.emergency_contact}</p>
          </CardContent>
        </Card>
      )}

      {hasMap && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Location</CardTitle>
          </CardHeader>
          <CardContent>
            <a
              className="text-primary inline-flex h-10 items-center text-sm underline"
              href={`https://www.google.com/maps?q=${data.property_lat},${data.property_lng}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open in Google Maps
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
