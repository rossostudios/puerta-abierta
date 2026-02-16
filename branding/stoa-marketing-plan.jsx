import { useState } from "react";

const c = {
  night: "#641220", crimson: "#DA1E37", scarlet: "#E01E37",
  cherry: "#C71F37", burg: "#85182A", burgII: "#6E1423",
  white: "#FFFFFF", g50: "#FAFAFA", g100: "#F4F4F5", g200: "#E4E4E7",
  g400: "#A1A1AA", g500: "#71717A", g600: "#52525B",
  g700: "#3F3F46", g800: "#27272A", g900: "#18181B", g950: "#09090B",
};

const f = "Geist, 'Geist Sans', system-ui, -apple-system, sans-serif";
const mono = "'Geist Mono', 'SF Mono', monospace";

const StoaMark = ({ size = 20, color = c.crimson }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <line x1="5" y1="5.5" x2="27" y2="5.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="5" y1="26.5" x2="27" y2="26.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <rect x="7.5" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.9" />
    <rect x="14.25" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.55" />
    <rect x="21" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.3" />
  </svg>
);

export default function StoaMarketingPlan() {
  const [mode, setMode] = useState("light");
  const [activeTab, setActiveTab] = useState("all");
  const dark = mode === "dark";

  const bg = dark ? c.g950 : c.white;
  const fg = dark ? c.g50 : c.g950;
  const muted = dark ? c.g500 : c.g400;
  const subtle = dark ? c.g400 : c.g500;
  const surface = dark ? c.g900 : c.g50;
  const border = dark ? c.g800 : c.g200;
  const surfaceAlt = dark ? c.g800 : c.g100;
  const accentBg = dark ? "rgba(218,30,55,0.06)" : "rgba(218,30,55,0.03)";
  const accentBorder = dark ? "rgba(218,30,55,0.15)" : "rgba(218,30,55,0.1)";

  const Pill = ({ children, active, onClick }) => (
    <button onClick={onClick} style={{ background: active ? (dark ? c.white : c.g950) : "transparent", color: active ? (dark ? c.g950 : "#fff") : (dark ? c.g500 : c.g400), border: "none", borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: f }}>{children}</button>
  );
  const Hr = () => <div style={{ height: 1, background: border, margin: "52px 0" }} />;
  const Num = ({ n, title, desc }) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: c.crimson, fontFamily: mono }}>{n}</span>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: fg, margin: 0, letterSpacing: "-0.02em", fontFamily: f }}>{title}</h2>
      </div>
      {desc && <p style={{ fontSize: 13, color: subtle, margin: 0, lineHeight: 1.5, fontFamily: f, paddingLeft: 34 }}>{desc}</p>}
    </div>
  );
  const Label = ({ children, style: s }) => (
    <div style={{ fontSize: 11, fontWeight: 500, color: muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, fontFamily: f, ...s }}>{children}</div>
  );
  const Card = ({ children, accent, padded = true, style: s }) => (
    <div style={{ background: accent ? accentBg : surface, border: `1px solid ${accent ? accentBorder : border}`, borderRadius: 12, padding: padded ? 22 : 0, ...s }}>{children}</div>
  );
  const Badge = ({ children, color: col }) => (
    <span style={{ background: col ? `${col}15` : accentBg, color: col || c.crimson, fontFamily: f, fontSize: 10.5, fontWeight: 600, padding: "3px 8px", borderRadius: 5, letterSpacing: "0.02em" }}>{children}</span>
  );
  const Metric = ({ label, value, sub }) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 600, color: fg, fontFamily: f, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 500, color: subtle, fontFamily: f, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: muted, fontFamily: f, marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const TimelineItem = ({ week, title, tasks, phase }) => {
    const phaseColors = { "Foundation": "#3B82F6", "Growth": "#22C55E", "Scale": "#F59E0B" };
    return (
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 48 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: phaseColors[phase] || c.crimson, marginBottom: 4 }} />
          <div style={{ width: 1, flex: 1, background: border }} />
        </div>
        <div style={{ flex: 1, paddingBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: phaseColors[phase] || c.crimson, fontFamily: mono }}>{week}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f }}>{title}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {tasks.map((t, i) => (
              <span key={i} style={{ fontSize: 11.5, color: subtle, fontFamily: f, background: surfaceAlt, padding: "3px 8px", borderRadius: 5 }}>{t}</span>
            ))}
          </div>
        </div>
      </div>
    );
  };
  const FunnelRow = ({ stage, channels, metric, color: col }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}` }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 }} />
      <div style={{ width: 100, fontSize: 13, fontWeight: 600, color: fg, fontFamily: f }}>{stage}</div>
      <div style={{ flex: 1, fontSize: 12, color: subtle, fontFamily: f }}>{channels}</div>
      <div style={{ fontSize: 11, color: muted, fontFamily: mono, textAlign: "right", minWidth: 80 }}>{metric}</div>
    </div>
  );

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
* { box-sizing: border-box; margin: 0; }
::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 3px; }`}</style>

      <div style={{ minHeight: "100vh", background: bg, fontFamily: f }}>
        {/* Header */}
        <div style={{ position: "sticky", top: 0, zIndex: 100, background: dark ? "rgba(9,9,11,0.82)" : "rgba(255,255,255,0.82)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${border}`, padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StoaMark size={20} color={c.crimson} />
            <span style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: fg, letterSpacing: "0.08em" }}>STOA</span>
            <span style={{ fontSize: 11, color: muted, fontFamily: f, marginLeft: 4 }}>Marketing Plan 2026</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: dark ? c.g900 : c.g100, borderRadius: 999, padding: 2 }}>
            <Pill active={mode === "light"} onClick={() => setMode("light")}>Light</Pill>
            <Pill active={mode === "dark"} onClick={() => setMode("dark")}>Dark</Pill>
          </div>
        </div>

        <div style={{ maxWidth: 840, margin: "0 auto", padding: "52px 28px 80px" }}>
          {/* Hero */}
          <div style={{ marginBottom: 52 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: accentBg, border: `1px solid ${accentBorder}`, padding: "4px 12px", borderRadius: 999, marginBottom: 18 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: c.crimson }}>Q2–Q4 2026 · Growth Playbook</span>
            </div>
            <h1 style={{ fontSize: 40, fontWeight: 700, color: fg, margin: "0 0 10px", letterSpacing: "-0.04em", lineHeight: 1.05 }}>Marketing Strategy</h1>
            <p style={{ fontSize: 15, color: subtle, margin: 0, lineHeight: 1.6, maxWidth: 520 }}>
              A complete growth plan for STOA — SEO, content, AI automation, community, paid acquisition, and a 90-day launch roadmap. Built for a two-sided marketplace in an emerging market.
            </p>
          </div>

          <Hr />

          {/* 01 Executive Summary */}
          <Num n="01" title="Executive Summary" desc="The strategic thesis in 60 seconds." />

          <Card accent>
            <p style={{ fontSize: 15, color: fg, fontFamily: f, lineHeight: 1.7, margin: 0 }}>
              STOA operates in an <strong>underserved niche with exploding demand</strong>: foreigners moving to Paraguay. The market has no dominant player, SEO competition is minimal, and the audience is highly active in identifiable online communities. Our strategy exploits three advantages:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 18 }}>
              {[
                { n: "01", t: "Content moat", b: "We become the definitive English-language resource on living in Paraguay — before anyone else does." },
                { n: "02", t: "Community-led growth", b: "We embed in expat communities where decisions are made — Facebook groups, YouTube, Telegram, podcasts." },
                { n: "03", t: "AI-powered ops", b: "We automate lead nurture, content production, and PM onboarding with agents — running lean at 10x output." },
              ].map(({ n, t, b }) => (
                <div key={n} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: c.crimson, fontFamily: mono }}>{n}</span>
                  <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, margin: "4px 0", letterSpacing: "-0.01em" }}>{t}</div>
                  <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5 }}>{b}</div>
                </div>
              ))}
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
            <Card style={{ textAlign: "center", padding: 18 }}>
              <Metric value="0→1K" label="Marketplace Users" sub="First 6 months" />
            </Card>
            <Card style={{ textAlign: "center", padding: 18 }}>
              <Metric value="50+" label="Listed Properties" sub="90-day target" />
            </Card>
            <Card style={{ textAlign: "center", padding: 18 }}>
              <Metric value="15" label="PM Accounts" sub="Active managers" />
            </Card>
            <Card style={{ textAlign: "center", padding: 18 }}>
              <Metric value="10K" label="Monthly Organic" sub="Traffic @ month 6" />
            </Card>
          </div>

          <Hr />

          {/* 02 Funnel Architecture */}
          <Num n="02" title="Growth Funnel" desc="How users flow from discovery to conversion on both sides of the marketplace." />

          <Card padded={false}>
            <div style={{ padding: "16px 22px" }}>
              <FunnelRow stage="Awareness" channels="SEO blog, YouTube, social, podcast guesting, paid search" metric="Impressions" color="#3B82F6" />
              <FunnelRow stage="Interest" channels="Neighborhood guides, cost calculators, free tools" metric="Site visits" color="#6366F1" />
              <FunnelRow stage="Consideration" channels="Property search, comparison pages, email nurture, retargeting" metric="Sign-ups" color="#8B5CF6" />
              <FunnelRow stage="Conversion" channels="Booking flow, PM onboarding, demo calls" metric="Bookings / PMs" color={c.crimson} />
              <FunnelRow stage="Retention" channels="In-app experience, email sequences, PM dashboard value" metric="LTV / NPS" color="#22C55E" />
              <FunnelRow stage="Referral" channels="Referral program, community, testimonials, PM network effects" metric="Viral coefficient" color="#F59E0B" />
            </div>
          </Card>

          <div style={{ marginTop: 16 }}>
            <Label>Dual Flywheel</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 8 }}>🌎 Supply Side (PMs)</div>
                <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.6 }}>
                  More PMs → more listings → better selection → more tenants → more bookings → PMs earn more → PMs invite PMs → more PMs. <strong>Kickstart with direct outreach to 30 Asunción property managers.</strong>
                </div>
              </Card>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 8 }}>🔍 Demand Side (Tenants)</div>
                <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.6 }}>
                  Content attracts explorers → explorers search properties → bookings happen → reviews accumulate → SEO strengthens → more explorers find us. <strong>Kickstart with SEO content targeting "move to Paraguay" queries.</strong>
                </div>
              </Card>
            </div>
          </div>

          <Hr />

          {/* 03 SEO Strategy */}
          <Num n="03" title="SEO Strategy" desc="The lowest-cost, highest-ROI channel for STOA. Paraguay has almost zero English-language SEO competition." />

          <div style={{ marginBottom: 20 }}>
            <Label>Keyword Clusters — Priority Ranked</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                {
                  cluster: "Moving to Paraguay",
                  priority: "P0",
                  kws: ["moving to paraguay from usa", "how to move to paraguay", "paraguay residency requirements 2026", "cost of living paraguay", "is paraguay safe for expats"],
                  vol: "8K–15K/mo combined",
                  difficulty: "Low",
                  intent: "Informational → Transactional"
                },
                {
                  cluster: "Paraguay Rentals",
                  priority: "P0",
                  kws: ["apartments for rent asuncion paraguay", "furnished apartments asuncion", "long term rentals paraguay", "expat housing paraguay"],
                  vol: "3K–6K/mo combined",
                  difficulty: "Very Low",
                  intent: "Transactional"
                },
                {
                  cluster: "Paraguay Neighborhoods",
                  priority: "P1",
                  kws: ["best neighborhoods asuncion", "villa morra asuncion", "carmelitas neighborhood", "where to live in asuncion"],
                  vol: "2K–4K/mo combined",
                  difficulty: "Very Low",
                  intent: "Informational"
                },
                {
                  cluster: "Paraguay Residency",
                  priority: "P1",
                  kws: ["paraguay permanent residency", "cedula paraguay foreigner", "paraguay visa requirements", "paraguay immigration lawyer"],
                  vol: "5K–10K/mo combined",
                  difficulty: "Low",
                  intent: "Informational"
                },
                {
                  cluster: "Paraguay Investment",
                  priority: "P2",
                  kws: ["investing in paraguay real estate", "paraguay property prices", "buy apartment asuncion", "paraguay tax advantages"],
                  vol: "2K–5K/mo combined",
                  difficulty: "Low",
                  intent: "Informational → Transactional"
                },
                {
                  cluster: "PM Software Paraguay",
                  priority: "P2",
                  kws: ["property management software paraguay", "rental management asuncion", "landlord software latin america"],
                  vol: "500–1K/mo combined",
                  difficulty: "Very Low",
                  intent: "Transactional"
                },
              ].map(({ cluster, priority, kws, vol, difficulty, intent }) => (
                <Card key={cluster}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge color={priority === "P0" ? c.crimson : priority === "P1" ? "#F59E0B" : "#3B82F6"}>{priority}</Badge>
                      <span style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f }}>{cluster}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontSize: 11, color: muted, fontFamily: mono }}>{vol}</span>
                      <Badge color="#22C55E">{difficulty}</Badge>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {kws.map(kw => (
                      <span key={kw} style={{ fontSize: 11.5, color: subtle, fontFamily: mono, background: surfaceAlt, padding: "3px 8px", borderRadius: 4 }}>{kw}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: muted, fontFamily: f, marginTop: 8 }}>Intent: {intent}</div>
                </Card>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <Label>Technical SEO Checklist</Label>
            <Card>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  "Programmatic pages for every barrio (neighborhood)",
                  "Property listing schema markup (JSON-LD)",
                  "Hreflang tags for EN/ES versions",
                  "Open Graph + Twitter cards for property shares",
                  "Next.js SSR for all content pages (no client-only rendering)",
                  "Sitemap auto-generation for listings + blog",
                  "Core Web Vitals: LCP < 2.5s, CLS < 0.1",
                  "Internal linking mesh: blog ↔ listings ↔ neighborhood guides",
                  "FAQ schema on all informational pages",
                  "Canonical URLs to prevent duplicate listing pages",
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#22C55E", fontSize: 12, flexShrink: 0, marginTop: 1 }}>☐</span>
                    <span style={{ fontSize: 12, color: fg, fontFamily: f, lineHeight: 1.4 }}>{item}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div>
            <Label>Content Architecture</Label>
            <Card>
              <div style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.6, marginBottom: 12 }}>
                Every piece of content funnels toward a property search or PM sign-up. The blog isn't a blog — it's a <strong>programmatic content engine</strong> with three tiers:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[
                  { tier: "Pillar Pages", count: "8–12", ex: "The Complete Guide to Moving to Paraguay (5,000+ words)", purpose: "Rank for head terms, earn backlinks, establish authority." },
                  { tier: "Cluster Articles", count: "40–60", ex: "Best Neighborhoods in Asunción for Families", purpose: "Rank for long-tail queries, interlink to pillars." },
                  { tier: "Programmatic Pages", count: "100+", ex: "/neighborhoods/villa-morra, /neighborhoods/carmelitas", purpose: "Auto-generated from data. Every barrio, every property type, every price range." },
                ].map(({ tier, count, ex, purpose }) => (
                  <div key={tier} style={{ background: surfaceAlt, borderRadius: 8, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: f }}>{tier}</span>
                      <span style={{ fontSize: 11, color: c.crimson, fontFamily: mono }}>{count}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: subtle, fontFamily: f, lineHeight: 1.4, marginBottom: 6 }}>e.g. "{ex}"</div>
                    <div style={{ fontSize: 11, color: muted, fontFamily: f, lineHeight: 1.4 }}>{purpose}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Hr />

          {/* 04 AI & Automation */}
          <Num n="04" title="AI Agents & Automation Stack" desc="The force multiplier. Run a 50-person marketing operation with 3 people using AI agents, MCP servers, and workflow automation." />

          <Card accent>
            <div style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 12 }}>🤖 The STOA AI Marketing Stack</div>
            <div style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.6, marginBottom: 16 }}>
              Every repetitive marketing task should be an agent. Every data flow should be an MCP connection. The goal: <strong>one human reviews, the machine produces.</strong>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {[
              {
                agent: "Content Writer Agent",
                tools: ["Claude API", "Web Search MCP", "Notion MCP", "WordPress/CMS API"],
                flow: "Keyword list → Agent researches topic via web search → Writes draft in brand voice → Saves to Notion for review → Human edits → Publishes to CMS",
                output: "15–20 blog posts/month instead of 3–4",
                details: "Trained on STOA's brand voice guide. Uses web search MCP to pull current Paraguay data (exchange rates, visa rules, cost comparisons). Outputs in Markdown with SEO metadata, internal links, and FAQ schema pre-formatted."
              },
              {
                agent: "Social Content Agent",
                tools: ["Claude API", "Canva MCP", "Buffer/Typefully API", "Analytics MCP"],
                flow: "Blog post published → Agent extracts 5–8 social snippets → Generates carousel copy + image briefs → Schedules across platforms",
                output: "60+ social posts/month from 15 blog posts",
                details: "Repurposes every blog post into platform-native formats: Twitter/X threads, LinkedIn posts, Instagram carousel scripts, YouTube Shorts scripts. Uses Canva MCP to generate branded graphics with STOA templates."
              },
              {
                agent: "Lead Nurture Agent",
                tools: ["Claude API", "Email MCP (Resend/Loops)", "CRM MCP", "Notion MCP"],
                flow: "New sign-up → Agent classifies user type (Explorer/Relocator/PM/Investor) → Triggers personalized email sequence → Monitors engagement → Escalates warm leads to human",
                output: "100% of leads nurtured within 5 minutes, 24/7",
                details: "Writes personalized welcome emails based on sign-up context (what they searched, where they're from). 6-email drip per persona. A/B tests subject lines automatically. Escalates high-intent signals (viewed 5+ properties, PM with 10+ units) to founder."
              },
              {
                agent: "SEO Monitor Agent",
                tools: ["Google Search Console API", "Ahrefs/Semrush API", "Claude API", "Slack MCP"],
                flow: "Weekly: Pulls rankings, traffic, new keyword opportunities → Analyzes trends → Reports to Slack with action items → Suggests new content briefs",
                output: "Weekly SEO report + 5 content briefs, zero manual work",
                details: "Tracks all target keyword clusters. Alerts on ranking drops. Identifies emerging queries (new Paraguay visa changes, new expat trends). Auto-generates content briefs for the Content Writer Agent."
              },
              {
                agent: "PM Onboarding Agent",
                tools: ["Claude API", "STOA API", "WhatsApp Business API", "Calendar MCP"],
                flow: "New PM signs up → Agent sends WhatsApp welcome (ES/EN) → Walks through property setup → Answers questions → Schedules demo if stuck",
                output: "PMs fully onboarded in <24 hours, zero manual handholding",
                details: "Conversational agent that speaks Spanish and English. Guides PMs through: account setup, first property listing, connecting payment methods, importing existing tenant data. If the PM gets stuck, schedules a 15-min call with a human."
              },
              {
                agent: "Listing Optimizer Agent",
                tools: ["Claude API", "STOA Database MCP", "Image Analysis API"],
                flow: "PM uploads listing → Agent reviews title, description, photos, pricing → Suggests improvements → Auto-enhances if PM opts in",
                output: "Every listing professionally written and optimized",
                details: "Rewrites listing descriptions for the English-speaking audience. Flags low-quality photos. Suggests competitive pricing based on comparable listings. Adds neighborhood context and nearby amenities automatically."
              },
            ].map(({ agent, tools, flow, output, details }) => (
              <Card key={agent}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f }}>{agent}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#22C55E", fontFamily: f, background: dark ? "rgba(34,197,94,0.1)" : "rgba(34,197,94,0.06)", padding: "3px 8px", borderRadius: 4 }}>{output}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {tools.map(t => (
                    <span key={t} style={{ fontSize: 10.5, fontWeight: 500, color: muted, fontFamily: mono, background: surfaceAlt, padding: "2px 7px", borderRadius: 4 }}>{t}</span>
                  ))}
                </div>
                <div style={{ fontSize: 12.5, color: subtle, fontFamily: f, lineHeight: 1.5, marginBottom: 8 }}>
                  <strong style={{ color: fg }}>Flow:</strong> {flow}
                </div>
                <div style={{ fontSize: 12, color: muted, fontFamily: f, lineHeight: 1.5, background: surfaceAlt, borderRadius: 8, padding: "10px 12px" }}>
                  {details}
                </div>
              </Card>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <Label>MCP Server Architecture</Label>
            <Card>
              <div style={{ fontFamily: mono, fontSize: 12, color: subtle, lineHeight: 2, whiteSpace: "pre-wrap" }}>
{`┌─────────────────────────────────────────────────┐
│                 CLAUDE (Brain)                   │
│         Brand voice · Decision logic             │
└────────┬───────┬───────┬───────┬───────┬────────┘
         │       │       │       │       │
    ┌────▼──┐ ┌──▼───┐ ┌▼────┐ ┌▼────┐ ┌▼─────┐
    │Notion │ │Canva │ │Email│ │Slack│ │STOA  │
    │  MCP  │ │ MCP  │ │ MCP │ │ MCP │ │ API  │
    └───────┘ └──────┘ └─────┘ └─────┘ └──────┘
    Content    Design   Nurture  Alerts  Listings
    Calendar   Assets   Drips    Reports Tenants
    Briefs     Social   A/B Test Comms   Bookings`}
              </div>
            </Card>
          </div>

          <Hr />

          {/* 05 Content Marketing */}
          <Num n="05" title="Content Marketing" desc="Content is our primary acquisition channel. Every piece earns traffic, builds trust, and drives toward a property search." />

          <div style={{ marginBottom: 20 }}>
            <Label>Content Calendar — First 90 Days</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { type: "Pillar", title: "The Complete Guide to Moving to Paraguay in 2026", kw: "moving to paraguay", priority: "Week 1" },
                { type: "Pillar", title: "Cost of Living in Paraguay: Real Numbers from Real Expats", kw: "cost of living paraguay", priority: "Week 2" },
                { type: "Pillar", title: "Paraguay Residency: Step-by-Step for Foreigners", kw: "paraguay residency", priority: "Week 3" },
                { type: "Cluster", title: "Best Neighborhoods in Asunción (Ranked by Expats)", kw: "best neighborhoods asuncion", priority: "Week 4" },
                { type: "Cluster", title: "Furnished Apartments in Asunción: What to Expect", kw: "furnished apartments asuncion", priority: "Week 5" },
                { type: "Cluster", title: "Opening a Bank Account in Paraguay as a Foreigner", kw: "bank account paraguay foreigner", priority: "Week 6" },
                { type: "Pillar", title: "Paraguay vs Other Expat Destinations (Comparison)", kw: "paraguay vs [country]", priority: "Week 7" },
                { type: "Tool", title: "Paraguay Cost of Living Calculator (Interactive)", kw: "paraguay cost calculator", priority: "Week 8" },
                { type: "Cluster", title: "Is Paraguay Safe? An Honest Assessment", kw: "is paraguay safe", priority: "Week 9" },
                { type: "Cluster", title: "Healthcare in Paraguay: Insurance, Hospitals, Costs", kw: "healthcare paraguay expat", priority: "Week 10" },
              ].map(({ type, title, kw, priority }) => (
                <div key={title} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <Badge color={type === "Pillar" ? c.crimson : type === "Tool" ? "#6366F1" : "#F59E0B"}>{type}</Badge>
                    <span style={{ fontSize: 10, color: muted, fontFamily: mono }}>{priority}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: fg, fontFamily: f, lineHeight: 1.4, flex: 1 }}>{title}</div>
                  <div style={{ fontSize: 10.5, color: muted, fontFamily: mono, marginTop: 6 }}>{kw}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Video & YouTube Strategy</Label>
            <Card>
              <div style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.6, marginBottom: 12 }}>
                YouTube is the <strong>#1 channel for expat decision-making</strong>. People don't just Google "move to Paraguay" — they watch 10 hours of YouTube videos about it first. Our strategy:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { series: "Neighborhood Tours", freq: "2x/month", desc: "Walk through Villa Morra, Carmelitas, etc. with real footage, prices, and local tips. End with STOA listings in the area." },
                  { series: "Expat Interviews", freq: "2x/month", desc: "5-minute interviews with people who moved. What surprised them. What they wish they knew. Authentic, unscripted." },
                  { series: "The Numbers", freq: "Monthly", desc: "Hard data: rent prices, grocery costs, utility bills, maid services. Screen-recorded comparisons. Trust through transparency." },
                  { series: "STOA Updates", freq: "Monthly", desc: "New features, new listings, market insights. Builds the brand as a living, growing platform." },
                ].map(({ series, freq, desc }) => (
                  <div key={series} style={{ background: surfaceAlt, borderRadius: 8, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: f }}>{series}</span>
                      <span style={{ fontSize: 10, color: muted, fontFamily: mono }}>{freq}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: subtle, fontFamily: f, lineHeight: 1.5 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Hr />

          {/* 06 Community & Partnerships */}
          <Num n="06" title="Community-Led Growth" desc="The expat community is tight, vocal, and trusts peer recommendations over ads. We embed in it." />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[
              { ch: "Facebook Groups", handle: "Paraguay Expats, Asuncion Expats, etc.", tactic: "Become the most helpful member. Answer questions about housing daily. Link to STOA guides (not listings) when relevant. Never spam.", metric: "3–5 helpful posts/week" },
              { ch: "YouTube Collaborations", handle: "Expat YouTubers with 5K–100K subs", tactic: "Sponsor neighborhood tours or 'I tried living in Paraguay' videos. Provide free stays via PM partners. STOA credited, not forced.", metric: "2 collabs/month" },
              { ch: "Telegram / WhatsApp Groups", handle: "Paraguay expat chats, crypto-nomad groups", tactic: "Share original research and guides. Be the resource, not the pitch. Build a STOA community channel for property alerts.", metric: "Own channel: 500 members by month 6" },
              { ch: "Podcast Guesting", handle: "Expat Money Show, Nomad Capitalist, etc.", tactic: "Founder appears as Paraguay expert. Talks about the market, residency process, and lifestyle — not the product. Mention STOA naturally.", metric: "2 appearances/month" },
              { ch: "Immigration Lawyers", handle: "Top 10 Paraguay immigration firms", tactic: "Referral partnership: lawyers recommend STOA for housing, we recommend vetted lawyers to our users. Revenue share or flat fee per referral.", metric: "5 active partnerships" },
              { ch: "Relocation Agencies", handle: "Companies helping people move to Paraguay", tactic: "White-label the STOA marketplace for their clients. They get branded search. We get qualified demand. Win-win.", metric: "3 agency partnerships" },
            ].map(({ ch, handle, tactic, metric }) => (
              <Card key={ch}>
                <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 2 }}>{ch}</div>
                <div style={{ fontSize: 11, color: muted, fontFamily: f, marginBottom: 8 }}>{handle}</div>
                <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5, marginBottom: 8 }}>{tactic}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: c.crimson, fontFamily: mono }}>{metric}</div>
              </Card>
            ))}
          </div>

          <Card accent>
            <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 6 }}>💡 The Referral Engine</div>
            <div style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.6 }}>
              Every tenant who books through STOA gets a unique referral link. If a friend books, both get <strong>one week free</strong> on their next stay. Property managers who refer other PMs get <strong>one month free on their SaaS subscription</strong>. Track everything through UTM parameters and the STOA dashboard. Referral is our most cost-efficient channel after SEO — the CAC approaches zero.
            </div>
          </Card>

          <Hr />

          {/* 07 Paid Acquisition */}
          <Num n="07" title="Paid Acquisition" desc="Paid is a scalpel, not a firehose. We use it to accelerate what organic is already proving." />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 8 }}>Google Ads — Search</div>
              <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5, marginBottom: 10 }}>
                Target transactional queries only: "apartments for rent asuncion", "furnished rentals paraguay". CPCs are extremely low ($0.15–0.60) due to minimal competition. Only run on keywords where we have a landing page that converts.
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Budget:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>$500/mo</span></div>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Target CPA:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>$8–12</span></div>
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 8 }}>Meta Ads — Facebook/Instagram</div>
              <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5, marginBottom: 10 }}>
                Retarget blog readers with property listings. Lookalike audiences from email list. Interest targeting: "expat life", "digital nomad", "international relocation" + US/Canada/EU geos. Carousel ads with real property photos.
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Budget:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>$800/mo</span></div>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Target CPA:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>$5–10</span></div>
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 8 }}>YouTube Ads — Pre-roll</div>
              <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5, marginBottom: 10 }}>
                Target viewers of Paraguay expat videos. 15-second pre-roll: "Looking for a place in Paraguay? STOA has vetted, furnished properties ready now." Only run when we have 20+ active listings to show.
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Budget:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>$400/mo</span></div>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Target CPV:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>$0.03–0.06</span></div>
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 8 }}>Sponsor Placements</div>
              <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5, marginBottom: 10 }}>
                Newsletter sponsorships in expat newsletters (Nomad Capitalist, Expat Money, International Living). Podcast mid-roll ads. These audiences are pre-qualified and high-intent. Negotiate CPA deals where possible.
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Budget:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>$600/mo</span></div>
                <div><span style={{ fontSize: 11, color: muted, fontFamily: f }}>Target:</span> <span style={{ fontSize: 12, fontWeight: 600, color: fg, fontFamily: mono }}>2 sponsors/mo</span></div>
              </div>
            </Card>
          </div>

          <div style={{ background: surfaceAlt, borderRadius: 10, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f }}>Total Monthly Paid Budget</span>
            <span style={{ fontSize: 18, fontWeight: 600, color: c.crimson, fontFamily: mono }}>$2,300/mo</span>
          </div>
          <p style={{ fontSize: 11, color: muted, fontFamily: f, marginTop: 6 }}>Rule: Don't scale paid until organic proves the conversion funnel works. Paid amplifies, it doesn't replace.</p>

          <Hr />

          {/* 08 Metrics */}
          <Num n="08" title="KPIs & Measurement" desc="What we track, how we track it, and what good looks like." />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { category: "Acquisition", metrics: [
                { name: "Organic traffic", target: "10K/mo by month 6", tool: "Google Analytics + Search Console" },
                { name: "Keyword rankings (P0 cluster)", target: "Top 5 for 10+ keywords", tool: "Ahrefs / Semrush" },
                { name: "Sign-ups (marketplace)", target: "200/mo by month 4", tool: "STOA analytics" },
                { name: "PM sign-ups", target: "5/mo by month 3", tool: "STOA analytics" },
              ]},
              { category: "Engagement", metrics: [
                { name: "Property searches per user", target: "> 3 per session", tool: "STOA analytics" },
                { name: "Email open rate", target: "> 35%", tool: "Loops / Resend" },
                { name: "Blog avg. time on page", target: "> 4 minutes", tool: "Google Analytics" },
                { name: "Social engagement rate", target: "> 3%", tool: "Buffer analytics" },
              ]},
              { category: "Conversion", metrics: [
                { name: "Search → booking rate", target: "> 2%", tool: "STOA analytics" },
                { name: "PM trial → paid conversion", target: "> 25%", tool: "STOA analytics" },
                { name: "Cost per booking (paid)", target: "< $15", tool: "Meta/Google Ads" },
                { name: "Referral viral coefficient", target: "> 0.3", tool: "STOA referral tracking" },
              ]},
              { category: "Retention", metrics: [
                { name: "PM monthly churn", target: "< 5%", tool: "STOA analytics" },
                { name: "Tenant repeat booking rate", target: "> 15%", tool: "STOA analytics" },
                { name: "NPS score", target: "> 50", tool: "In-app survey" },
                { name: "Support response time", target: "< 2 hours", tool: "Help desk" },
              ]},
            ].map(({ category, metrics }) => (
              <Card key={category}>
                <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 10 }}>{category}</div>
                {metrics.map(({ name, target, tool }) => (
                  <div key={name} style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.5fr", padding: "6px 0", borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"}`, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: fg, fontFamily: f }}>{name}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 500, color: c.crimson, fontFamily: mono }}>{target}</span>
                    <span style={{ fontSize: 11, color: muted, fontFamily: f }}>{tool}</span>
                  </div>
                ))}
              </Card>
            ))}
          </div>

          <Hr />

          {/* 09 90-Day Roadmap */}
          <Num n="09" title="90-Day Launch Roadmap" desc="Week-by-week execution plan. Three phases: Foundation → Growth → Scale." />

          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {[
              { label: "Foundation", color: "#3B82F6", weeks: "Wk 1–4" },
              { label: "Growth", color: "#22C55E", weeks: "Wk 5–8" },
              { label: "Scale", color: "#F59E0B", weeks: "Wk 9–12" },
            ].map(({ label, color, weeks }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: fg, fontFamily: f }}>{label}</span>
                <span style={{ fontSize: 10, color: muted, fontFamily: mono }}>{weeks}</span>
              </div>
            ))}
          </div>

          <Card>
            <TimelineItem week="WK 01" title="Infrastructure" phase="Foundation" tasks={["Google Analytics + Search Console", "Blog + CMS setup (MDX / Contentlayer)", "Schema markup templates", "Brand voice doc → AI agent system prompts"]} />
            <TimelineItem week="WK 02" title="First Pillar Content" phase="Foundation" tasks={["Publish: Moving to Paraguay guide", "Publish: Cost of Living guide", "Set up Content Writer Agent", "Seed 5 Facebook group posts"]} />
            <TimelineItem week="WK 03" title="Supply Side Push" phase="Foundation" tasks={["Direct outreach to 30 Asunción PMs", "PM onboarding flow live", "PM Onboarding Agent deployed", "First 10 listings target"]} />
            <TimelineItem week="WK 04" title="Email & Nurture" phase="Foundation" tasks={["Lead Nurture Agent live", "4 email sequences (per persona)", "Welcome flow A/B testing", "Referral program soft launch"]} />
            <TimelineItem week="WK 05" title="Content Acceleration" phase="Growth" tasks={["5 cluster articles published", "Neighborhood programmatic pages (top 10 barrios)", "YouTube channel launch + first 2 videos", "Social Content Agent deployed"]} />
            <TimelineItem week="WK 06" title="Community Embedding" phase="Growth" tasks={["Active in 5+ Facebook groups", "First podcast appearance", "Telegram community channel launched", "First YouTube collab negotiated"]} />
            <TimelineItem week="WK 07" title="Paid Pilot" phase="Growth" tasks={["Google Ads: 5 transactional keywords", "Meta retargeting: blog readers → listings", "Track CPA across channels", "Kill underperformers by day 14"]} />
            <TimelineItem week="WK 08" title="Interactive Tools" phase="Growth" tasks={["Paraguay Cost Calculator live", "Neighborhood comparison tool", "Residency checklist tool", "These become link magnets for SEO"]} />
            <TimelineItem week="WK 09" title="Scale Content" phase="Scale" tasks={["15+ articles live, 3 pillars indexed", "SEO Monitor Agent weekly reports", "Listing Optimizer Agent deployed", "Content → 4 posts/week cadence"]} />
            <TimelineItem week="WK 10" title="Partnership Activation" phase="Scale" tasks={["2 immigration lawyer partnerships live", "1 relocation agency white-label", "First YouTube sponsor placement", "Expat newsletter sponsor (1 placement)"]} />
            <TimelineItem week="WK 11" title="Optimize & Double Down" phase="Scale" tasks={["Analyze: top 5 converting pages → create 10 variants", "Email: optimize sequences based on 6 weeks data", "Paid: scale winning campaigns 2x", "PM count target: 15 active"]} />
            <TimelineItem week="WK 12" title="Review & Plan Q3" phase="Scale" tasks={["Full funnel audit: traffic → sign-up → booking", "CAC by channel analysis", "PM satisfaction survey", "Q3 plan: expand to Ciudad del Este?"]} />
          </Card>

          <Hr />

          {/* 10 Budget Summary */}
          <Num n="10" title="Budget Overview" desc="Lean and efficient. AI agents replace headcount. Content is the primary investment." />

          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                { item: "AI / LLM API costs", monthly: "$200–400", note: "Claude API for all agents" },
                { item: "Content production", monthly: "$500", note: "Human editing, photography, video" },
                { item: "SEO tools", monthly: "$150", note: "Ahrefs or Semrush Lite" },
                { item: "Email platform", monthly: "$50", note: "Loops or Resend" },
                { item: "Social scheduling", monthly: "$30", note: "Buffer or Typefully" },
                { item: "Google Ads", monthly: "$500", note: "Transactional keywords only" },
                { item: "Meta Ads", monthly: "$800", note: "Retargeting + lookalikes" },
                { item: "YouTube Ads", monthly: "$400", note: "Pre-roll on expat content" },
                { item: "Sponsorships", monthly: "$600", note: "Newsletters + podcasts" },
                { item: "Miscellaneous", monthly: "$200", note: "Tools, freelancers, contingency" },
              ].map(({ item, monthly, note }, i) => (
                <div key={item} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", padding: "10px 0", borderBottom: i < 9 ? `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}` : "none", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: fg, fontFamily: f }}>{item}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: mono }}>{monthly}</span>
                  <span style={{ fontSize: 11.5, color: muted, fontFamily: f }}>{note}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: `2px solid ${border}` }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f }}>Total Monthly</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: c.crimson, fontFamily: mono }}>$3,430–3,630</span>
            </div>
          </Card>

          <p style={{ fontSize: 12, color: muted, fontFamily: f, marginTop: 8, lineHeight: 1.5 }}>
            This budget assumes a 1–2 person marketing team augmented by AI agents. As revenue grows, shift budget from paid to content and community — the channels with compounding returns.
          </p>

          <Hr />

          {/* 11 Quick Reference */}
          <Num n="11" title="Strategy on a Napkin" />

          <div style={{ background: `linear-gradient(135deg, ${c.night}, ${c.burg})`, borderRadius: 14, padding: 28, color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <StoaMark size={20} color="#fff" />
              <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.1em", fontFamily: f }}>STOA</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: f, marginLeft: 4 }}>Marketing 2026</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>Thesis</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>Own the English-language conversation about living in Paraguay before anyone else does.</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>Channels (Ranked)</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>1. SEO content  2. Community  3. YouTube  4. Referrals  5. Paid (amplifier)</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>Force Multiplier</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>6 AI agents producing 10x output. Claude + MCP servers for content, nurture, onboarding, SEO, social, and listing optimization.</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>6-Month Targets</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>10K organic visits/mo · 1K users · 50+ listings · 15 PMs · $3.5K/mo budget</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", paddingTop: 48, marginTop: 52, borderTop: `1px solid ${border}` }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <StoaMark size={16} color={c.crimson} />
              <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: fg, letterSpacing: "0.08em" }}>STOA</span>
            </div>
            <p style={{ fontSize: 11, color: muted, marginTop: 6, fontFamily: f }}>Marketing Strategy · rossostoa.com · Asunción, Paraguay · 2026</p>
          </div>
        </div>
      </div>
    </>
  );
}
