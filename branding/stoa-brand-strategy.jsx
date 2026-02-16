import { useState } from "react";

const c = {
  night: "#641220", crimson: "#DA1E37", scarlet: "#E01E37",
  cherry: "#C71F37", burg: "#85182A",
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

export default function StoaBrandStrategy() {
  const [mode, setMode] = useState("light");
  const dark = mode === "dark";

  const bg = dark ? c.g950 : c.white;
  const fg = dark ? c.g50 : c.g950;
  const muted = dark ? c.g500 : c.g400;
  const subtle = dark ? c.g400 : c.g500;
  const surface = dark ? c.g900 : c.g50;
  const border = dark ? c.g800 : c.g200;
  const surfaceAlt = dark ? c.g800 : c.g100;

  const Pill = ({ children, active, onClick }) => (
    <button onClick={onClick} style={{ background: active ? (dark ? c.white : c.g950) : "transparent", color: active ? (dark ? c.g950 : "#fff") : (dark ? c.g500 : c.g400), border: "none", borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: f }} >
      {children}
    </button>
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

  const Label = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 500, color: muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, fontFamily: f }}>{children}</div>
  );

  const Card = ({ children, accent, padded = true }) => (
    <div style={{
      background: accent ? (dark ? "rgba(218,30,55,0.06)" : "rgba(218,30,55,0.03)") : surface,
      border: `1px solid ${accent ? (dark ? "rgba(218,30,55,0.15)" : "rgba(218,30,55,0.1)") : border}`,
      borderRadius: 12, padding: padded ? 22 : 0,
    }}>
      {children}
    </div>
  );

  const Quote = ({ children, attr }) => (
    <div style={{ borderLeft: `3px solid ${c.crimson}`, paddingLeft: 18, margin: "16px 0" }}>
      <p style={{ fontSize: 16, fontWeight: 500, color: fg, fontFamily: f, fontStyle: "italic", lineHeight: 1.5, margin: 0, letterSpacing: "-0.01em" }}>"{children}"</p>
      {attr && <p style={{ fontSize: 12, color: muted, fontFamily: f, margin: "6px 0 0" }}>— {attr}</p>}
    </div>
  );

  const DoItem = ({ yes, children }) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 14, lineHeight: 1.4, flexShrink: 0, color: yes ? "#22C55E" : c.crimson }}>{yes ? "✓" : "✗"}</span>
      <span style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.5 }}>{children}</span>
    </div>
  );

  const PersonaCard = ({ emoji, title, subtitle, needs, pain, message }) => (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{emoji}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f, letterSpacing: "-0.01em" }}>{title}</div>
          <div style={{ fontSize: 12, color: muted, fontFamily: f }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontFamily: f }}>Needs</div>
        <div style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.5 }}>{needs}</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontFamily: f }}>Pain Point</div>
        <div style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.5 }}>{pain}</div>
      </div>
      <div style={{ background: dark ? "rgba(218,30,55,0.06)" : "rgba(218,30,55,0.03)", border: `1px solid ${dark ? "rgba(218,30,55,0.12)" : "rgba(218,30,55,0.08)"}`, borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: c.crimson, marginBottom: 3, fontFamily: f }}>STOA SAYS</div>
        <div style={{ fontSize: 13, color: fg, fontFamily: f, fontStyle: "italic", lineHeight: 1.4 }}>"{message}"</div>
      </div>
    </Card>
  );

  const ToneSlider = ({ label, left, right, position }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: subtle, fontFamily: f }}>{left}</span>
        <span style={{ fontSize: 12, color: subtle, fontFamily: f }}>{right}</span>
      </div>
      <div style={{ height: 4, background: surfaceAlt, borderRadius: 2, position: "relative" }}>
        <div style={{ position: "absolute", left: `${position}%`, top: -4, width: 12, height: 12, borderRadius: "50%", background: c.crimson, transform: "translateX(-50%)", boxShadow: "0 1px 4px rgba(218,30,55,0.3)" }} />
      </div>
    </div>
  );

  const CompCard = ({ name, role, us }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}` }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: fg, fontFamily: f }}>{name}</span>
      <span style={{ fontSize: 12, color: muted, fontFamily: f }}>{role}</span>
      {us && <span style={{ fontSize: 11, fontWeight: 500, color: c.crimson, fontFamily: f, background: dark ? "rgba(218,30,55,0.1)" : "rgba(218,30,55,0.05)", padding: "2px 8px", borderRadius: 4 }}>← STOA</span>}
    </div>
  );

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
* { box-sizing: border-box; margin: 0; }
::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 3px; }`}</style>

      <div style={{ minHeight: "100vh", background: bg, fontFamily: f, transition: "background 0.2s, color 0.2s" }}>
        {/* Header */}
        <div style={{ position: "sticky", top: 0, zIndex: 100, background: dark ? "rgba(9,9,11,0.82)" : "rgba(255,255,255,0.82)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${border}`, padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StoaMark size={20} color={c.crimson} />
            <span style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: fg, letterSpacing: "0.08em" }}>STOA</span>
            <span style={{ fontSize: 11, color: muted, fontFamily: f, marginLeft: 4 }}>Brand Strategy</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: dark ? c.g900 : c.g100, borderRadius: 999, padding: 2 }}>
            <Pill active={mode === "light"} onClick={() => setMode("light")}>Light</Pill>
            <Pill active={mode === "dark"} onClick={() => setMode("dark")}>Dark</Pill>
          </div>
        </div>

        <div style={{ maxWidth: 800, margin: "0 auto", padding: "52px 28px 80px" }}>
          {/* Hero */}
          <div style={{ marginBottom: 52 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: dark ? "rgba(218,30,55,0.08)" : "rgba(218,30,55,0.04)", border: `1px solid ${dark ? "rgba(218,30,55,0.15)" : "rgba(218,30,55,0.08)"}`, padding: "4px 12px", borderRadius: 999, marginBottom: 18 }}>
              <StoaMark size={11} color={c.crimson} />
              <span style={{ fontSize: 11.5, fontWeight: 500, color: c.crimson }}>rossostoa.com</span>
            </div>
            <h1 style={{ fontSize: 40, fontWeight: 700, color: fg, margin: "0 0 10px", letterSpacing: "-0.04em", lineHeight: 1.05 }}>Brand Strategy</h1>
            <p style={{ fontSize: 15, color: subtle, margin: 0, lineHeight: 1.6, maxWidth: 500 }}>
              Voice, positioning, audience, and messaging guidelines for STOA — the property marketplace and management platform built for Paraguay.
            </p>
          </div>

          <Hr />

          {/* 01 Positioning */}
          <Num n="01" title="Positioning" />

          <Card accent>
            <div style={{ marginBottom: 18 }}>
              <Label>Mission</Label>
              <p style={{ fontSize: 16, fontWeight: 500, color: fg, fontFamily: f, lineHeight: 1.5, letterSpacing: "-0.01em", margin: 0 }}>
                STOA makes Paraguay accessible. We help newcomers find a place to call home and give property managers the tools to run their business — all in one platform, built for how this market actually works.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <Label>What We Are</Label>
                <p style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.5, margin: 0 }}>A marketplace where foreigners discover and book vetted properties in Paraguay, and an end-to-end SaaS platform where property managers run their entire operation — listings, leases, guests, payments, maintenance.</p>
              </div>
              <div>
                <Label>What We're Not</Label>
                <p style={{ fontSize: 13, color: fg, fontFamily: f, lineHeight: 1.5, margin: 0 }}>We're not Airbnb. We're not just short-term vacation rentals. We serve people who are testing the waters — staying weeks or months while they decide if Paraguay is where they want to invest, build, or live. And we give PMs real operational tools, not just a listing feed.</p>
              </div>
            </div>
          </Card>

          <div style={{ marginTop: 20, marginBottom: 0 }}>
            <Label>Competitive Landscape</Label>
            <Card padded={false}>
              <div style={{ padding: "14px 20px" }}>
                <CompCard name="Guesty" role="Enterprise PM SaaS" />
                <CompCard name="Hospitable" role="Automation-first PM" />
                <CompCard name="PadSplit" role="Affordable co-living marketplace" />
                <CompCard name="STOA" role="Marketplace + PM SaaS for Paraguay" us />
              </div>
            </Card>
            <p style={{ fontSize: 12, color: muted, fontFamily: f, marginTop: 8, lineHeight: 1.5 }}>
              STOA's edge: vertical focus on Paraguay, dual-sided (marketplace + tools), and built for the specific workflows of mid-term / exploratory stays — not vacation rentals, not enterprise chains.
            </p>
          </div>

          <Hr />

          {/* 02 Slogan */}
          <Num n="02" title="Slogan & Taglines" desc="Options ranked by recommendation. The primary slogan should work on the homepage hero, in the app footer, and on a business card." />

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: `linear-gradient(135deg, ${c.night}, ${c.cherry})`, borderRadius: 14, padding: "28px 28px 24px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 12, right: 16, background: "rgba(255,255,255,0.12)", borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.7)", fontFamily: f, letterSpacing: "0.04em" }}>RECOMMENDED</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, fontFamily: f }}>Primary Slogan</div>
              <p style={{ fontSize: 26, fontWeight: 600, color: "#fff", fontFamily: f, lineHeight: 1.2, margin: 0, letterSpacing: "-0.03em" }}>Every property, under one roof.</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontFamily: f, marginTop: 10, lineHeight: 1.5, maxWidth: 400 }}>Double meaning: STOA as a covered structure + the platform that unifies marketplace and management. Works for both audiences.</p>
            </div>

            {[
              { line: "Find home. Manage everything.", note: "Split speaks to both sides — marketplace users and property managers — in one breath." },
              { line: "Structure for every property.", note: "Ties directly to the colonnade brand mark. Implies both physical structure and operational organization." },
              { line: "Your next chapter starts here.", note: "Emotional, journey-focused. Speaks to the foreigner exploring Paraguay as a life decision." },
              { line: "Where property management lives.", note: "Confident, positions STOA as the definitive platform. 'Lives' has a housing double meaning." },
            ].map(({ line, note }, i) => (
              <Card key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: muted, fontFamily: mono }}>ALT {String(i + 1).padStart(2, "0")}</span>
                </div>
                <p style={{ fontSize: 18, fontWeight: 600, color: fg, fontFamily: f, margin: "0 0 6px", letterSpacing: "-0.02em" }}>{line}</p>
                <p style={{ fontSize: 12, color: muted, fontFamily: f, lineHeight: 1.5, margin: 0 }}>{note}</p>
              </Card>
            ))}
          </div>

          <Hr />

          {/* 03 Brand Persona */}
          <Num n="03" title="Brand Persona" desc="If STOA were a person at a dinner party in Asunción, who would they be?" />

          <Card accent>
            <p style={{ fontSize: 15, color: fg, fontFamily: f, lineHeight: 1.7, margin: 0 }}>
              STOA is <strong>the well-connected local friend who moved here five years ago</strong>. They know which neighborhoods are safe, which landlords are reliable, and which lawyer to call for your cédula. They're not trying to sell you anything — they just know how things work and they're happy to help. They're calm, direct, and practical. They don't oversell Paraguay, but they're clearly bullish on it. When they recommend something, you trust it because they've been through the process themselves.
            </p>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
            {[
              { trait: "Knowledgeable", desc: "Knows Paraguay's rental market, residency process, and neighborhoods inside out." },
              { trait: "Trustworthy", desc: "Never oversells. Transparent about what's great and what's complicated." },
              { trait: "Practical", desc: "Solutions-oriented. Skips the fluff, gives you what you need to make a decision." },
              { trait: "Patient", desc: "Understands that moving countries is stressful. Doesn't rush. Supports exploration." },
              { trait: "Modern", desc: "Tech-forward but not intimidating. Clean, intuitive, no unnecessary complexity." },
              { trait: "Grounded", desc: "Rooted in Paraguay. Respects local customs while bridging cultural gaps." },
            ].map(({ trait, desc }) => (
              <div key={trait} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 4 }}>{trait}</div>
                <div style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <Hr />

          {/* 04 Tone of Voice */}
          <Num n="04" title="Tone of Voice" desc="How STOA sounds across every touchpoint — app copy, emails, marketing, support." />

          <div style={{ marginBottom: 24 }}>
            <Label>Tone Spectrum</Label>
            <Card>
              <ToneSlider left="Casual" right="Formal" position={35} />
              <ToneSlider left="Playful" right="Serious" position={60} />
              <ToneSlider left="Enthusiastic" right="Matter-of-fact" position={65} />
              <ToneSlider left="Technical" right="Simple" position={70} />
              <ToneSlider left="Distant" right="Warm" position={72} />
            </Card>
          </div>

          <div style={{ marginBottom: 24 }}>
            <Label>Voice Principles</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { title: "Clear over clever", body: "Our users are navigating a foreign country. Clarity isn't boring — it's respect. Say what you mean in as few words as possible." },
                { title: "Confident, not pushy", body: "We know our market. We make recommendations. But we never pressure. The user is making a life decision — let them explore at their own pace." },
                { title: "Warm, not bubbly", body: "Friendly and approachable without exclamation marks everywhere. Think helpful concierge, not enthusiastic tour guide." },
                { title: "Local expertise, global standards", body: "We bridge the gap. Use Paraguayan terms when useful (cédula, barrio) but always explain them. Never assume knowledge." },
              ].map(({ title, body }) => (
                <Card key={title}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: subtle, fontFamily: f, lineHeight: 1.5 }}>{body}</div>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <Label>Do's and Don'ts</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#22C55E", fontFamily: f, marginBottom: 10 }}>DO</div>
                <DoItem yes>"Your lease is ready for review." — Direct, clear.</DoItem>
                <DoItem yes>"This property is in Villa Morra, one of Asunción's most established neighborhoods." — Contextual, helpful.</DoItem>
                <DoItem yes>"Most foreigners open a bank account within their first week." — Normalizes the process.</DoItem>
                <DoItem yes>"3 properties match your search." — Let data speak.</DoItem>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: c.crimson, fontFamily: f, marginBottom: 10 }}>DON'T</div>
                <DoItem>"🎉 Amazing news! Your lease is READY!" — Over-excited.</DoItem>
                <DoItem>"You won't find a better deal anywhere!" — Salesy, unverifiable.</DoItem>
                <DoItem>"Paraguay is the best country in South America for expats." — Overselling, subjective.</DoItem>
                <DoItem>"As per our policy, pursuant to..." — Legalistic, cold.</DoItem>
              </div>
            </div>
          </div>

          <Hr />

          {/* 05 Audience */}
          <Num n="05" title="Target Audiences" desc="Two primary audiences, one platform. The marketplace serves guests. The SaaS serves property managers." />

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <PersonaCard
              emoji="🌎"
              title="The Explorer"
              subtitle="Foreigner considering Paraguay · 60% of marketplace users"
              needs="A vetted, furnished place to stay for 1–6 months while they explore residency, check out neighborhoods, open a bank account, and see if Paraguay fits."
              pain="They don't know anyone, can't read Spanish rental sites, don't trust random Facebook groups, and have no idea which barrios are safe or convenient."
              message="We've already done the homework. Browse vetted properties, book with confidence, and settle in while you figure out your next move."
            />
            <PersonaCard
              emoji="🏠"
              title="The Relocator"
              subtitle="Committed mover or investor · 30% of marketplace users"
              needs="Longer-term housing, local contacts (lawyers, dentists, accountants), and a smooth transition from temporary to permanent."
              pain="They've decided on Paraguay but the logistics of actually setting up a life — cédula, bank account, lease, utilities — are overwhelming without a guide."
              message="You've made the decision. Now let us help you make the transition — from your first rental to your permanent address."
            />
            <PersonaCard
              emoji="🔑"
              title="The Property Manager"
              subtitle="Local PM or landlord · SaaS side"
              needs="A modern platform to list properties, manage tenants and guests, handle reservations, track payments, coordinate maintenance, and grow their portfolio."
              pain="They're duct-taping WhatsApp, spreadsheets, and maybe Guesty or a legacy PMS that wasn't built for the Paraguayan market. Nothing is integrated."
              message="One platform for your entire operation. List on our marketplace, manage your guests, automate your workflow. Built for how you actually work."
            />
            <PersonaCard
              emoji="🏢"
              title="The Investor"
              subtitle="Remote owner or developer · 10% of marketplace users"
              needs="Visibility into their Paraguayan property portfolio, reliable management, and confidence that their investment is performing."
              pain="They own property in Paraguay but live abroad. They need transparency, reporting, and a PM they can trust — all accessible from a dashboard."
              message="Your properties, managed and transparent. Track performance, review financials, and know what's happening — from anywhere."
            />
          </div>

          <Hr />

          {/* 06 Messaging Framework */}
          <Num n="06" title="Messaging by Context" desc="How tone shifts across different touchpoints while staying recognizably STOA." />

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              {
                context: "Homepage Hero",
                tone: "Confident, inviting",
                example: "Find your place in Paraguay. Whether you're exploring for a month or settling for good, STOA connects you with vetted properties and the tools to manage them.",
              },
              {
                context: "Empty State (No listings)",
                tone: "Calm, encouraging",
                example: "No listings yet. As you add properties and connect integrations, your marketplace will come to life here.",
              },
              {
                context: "Onboarding Email",
                tone: "Warm, practical",
                example: "Welcome to STOA. Your account is set up. The first thing most managers do is add their properties — it takes about 5 minutes per unit. Here's how to start.",
              },
              {
                context: "Payment Confirmation",
                tone: "Clean, factual",
                example: "Payment received: ₲3,200,000 from Maria Garcia for Unit 4B, Sunset Villa. Due date was Feb 1. Paid Feb 1.",
              },
              {
                context: "Maintenance Alert",
                tone: "Direct, action-oriented",
                example: "New request: AC unit not cooling in Unit 12A, Park Tower. Tenant priority: High. Assign a vendor or respond within 24 hours.",
              },
              {
                context: "Marketing / Social",
                tone: "Approachable, informative",
                example: "Paraguay's cost of living is about 60% lower than the US — but finding a reliable rental as a foreigner isn't easy. That's why we built STOA.",
              },
              {
                context: "Error Message",
                tone: "Honest, helpful",
                example: "Something went wrong saving your listing. Your changes weren't lost — try again, or reach out to support if this keeps happening.",
              },
            ].map(({ context, tone, example }) => (
              <div key={context} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f }}>{context}</span>
                  <span style={{ fontSize: 11, color: c.crimson, fontFamily: f, fontWeight: 500 }}>{tone}</span>
                </div>
                <p style={{ fontSize: 13, color: subtle, fontFamily: f, lineHeight: 1.6, margin: 0, fontStyle: "italic" }}>"{example}"</p>
              </div>
            ))}
          </div>

          <Hr />

          {/* 07 Language & Localization */}
          <Num n="07" title="Language & Localization" desc="STOA operates at the intersection of English and Spanish. Guidelines for navigating both." />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Card>
              <Label>Primary Language</Label>
              <p style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f, margin: "0 0 4px" }}>English</p>
              <p style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5, margin: 0 }}>Our primary audience is English-speaking foreigners. The app, marketing, and support default to English.</p>
            </Card>
            <Card>
              <Label>Secondary Language</Label>
              <p style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f, margin: "0 0 4px" }}>Spanish</p>
              <p style={{ fontSize: 12, color: subtle, fontFamily: f, lineHeight: 1.5, margin: 0 }}>Property managers and local tenants may prefer Spanish. The PM dashboard and tenant-facing surfaces should support full i18n.</p>
            </Card>
          </div>

          <Card>
            <Label>Spanish Terms to Use (with context)</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { term: "Cédula", def: "National ID card — always explain on first use" },
                { term: "Barrio", def: "Neighborhood — use interchangeably with English" },
                { term: "Departamento", def: "Apartment — prefer 'unit' or 'apartment' in English UI" },
                { term: "Garantía", def: "Security deposit — translate in formal contexts" },
                { term: "Expensas", def: "Building fees / HOA — explain as 'common fees'" },
                { term: "Inmobiliaria", def: "Real estate agency — use 'agency' in English" },
              ].map(({ term, def }) => (
                <div key={term} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: mono, minWidth: 100 }}>{term}</span>
                  <span style={{ fontSize: 12, color: subtle, fontFamily: f }}>{def}</span>
                </div>
              ))}
            </div>
          </Card>

          <Hr />

          {/* 08 Brand Values */}
          <Num n="08" title="Brand Values" desc="The principles that guide every product decision, every piece of copy, every interaction." />

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            {[
              { icon: "🏛️", value: "Structure creates freedom", body: "Like a stoa that provides shelter without walls, our tools give property managers and tenants a framework to operate freely within. Structure isn't restriction — it's what makes everything else possible." },
              { icon: "🌍", value: "Bridge, don't gate-keep", body: "Paraguay has real barriers for foreigners: language, trust, local knowledge. Our job is to lower those barriers, not monetize them. Every feature should make the market more accessible, not more opaque." },
              { icon: "🤝", value: "Earn trust through transparency", body: "Show real photos. Display real prices. Explain real processes. In a market where trust is scarce, transparency is our competitive advantage." },
              { icon: "⚡", value: "Build for how people actually work", body: "Property managers in Paraguay use WhatsApp, not Slack. Tenants pay in guaraníes, not USD. Our tools should meet users where they are, not force them into Silicon Valley workflows." },
              { icon: "🌱", value: "Grow the market, not just the company", body: "When property managers professionalize, tenants get better experiences. When tenants have good experiences, more people move to Paraguay. Our success is tied to the market's success." },
            ].map(({ icon, value, body }) => (
              <div key={value} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 22, display: "flex", gap: 16 }}>
                <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>{icon}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f, letterSpacing: "-0.01em", marginBottom: 4 }}>{value}</div>
                  <div style={{ fontSize: 13, color: subtle, fontFamily: f, lineHeight: 1.6 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>

          <Hr />

          {/* 09 Quick Reference */}
          <Num n="09" title="Quick Reference Card" desc="The cheat sheet. Pin this." />

          <div style={{ background: `linear-gradient(135deg, ${c.night}, ${c.burg})`, borderRadius: 14, padding: 28, color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <StoaMark size={20} color="#fff" />
              <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.1em", fontFamily: f }}>STOA</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>Slogan</div>
                <div style={{ fontSize: 15, fontWeight: 500, fontFamily: f }}>Every property, under one roof.</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>Persona</div>
                <div style={{ fontSize: 13, fontFamily: f, lineHeight: 1.4, color: "rgba(255,255,255,0.8)" }}>The well-connected friend who moved here five years ago.</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>Tone</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.8)" }}>Clear. Warm. Confident. Never pushy.</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>Audiences</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.8)" }}>Explorers · Relocators · Property Managers · Investors</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>We Are</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.8)" }}>Marketplace + SaaS for Paraguay property.</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: f }}>We're Not</div>
                <div style={{ fontSize: 13, fontFamily: f, color: "rgba(255,255,255,0.8)" }}>Airbnb. A vacation rental site. Generic PM software.</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", paddingTop: 48, marginTop: 52, borderTop: `1px solid ${border}` }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <StoaMark size={16} color={c.crimson} />
              <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: fg, letterSpacing: "0.08em" }}>STOA</span>
            </div>
            <p style={{ fontSize: 11, color: muted, marginTop: 6, fontFamily: f }}>Brand Strategy · rossostoa.com · Asunción, Paraguay · 2026</p>
          </div>
        </div>
      </div>
    </>
  );
}
