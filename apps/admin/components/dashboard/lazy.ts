import dynamic from "next/dynamic";

export const LazyDashboardInsights = dynamic(() =>
  import("./insights").then((m) => m.DashboardInsights)
);

export const LazyOccupancyForecast = dynamic(() =>
  import("./occupancy-forecast").then((m) => m.OccupancyForecast)
);

export const LazyRevenueTrend = dynamic(() =>
  import("./revenue-trend").then((m) => m.RevenueTrend)
);

export const LazyAgentPerformance = dynamic(() =>
  import("./agent-performance").then((m) => m.AgentPerformance)
);
