import { useState } from "react";

// ── Color System ──
const c = {
  night: "#641220", burg: "#6E1423", burgII: "#85182A", ruby: "#A11D33",
  carmine: "#B21E35", cherry: "#C71F37", crimson: "#DA1E37", scarlet: "#E01E37",
  white: "#FFFFFF", g50: "#FAFAFA", g100: "#F4F4F5", g200: "#E4E4E7",
  g300: "#D4D4D8", g400: "#A1A1AA", g500: "#71717A", g600: "#52525B",
  g700: "#3F3F46", g800: "#27272A", g900: "#18181B", g950: "#09090B",
};

const f = "Geist, 'Geist Sans', system-ui, -apple-system, sans-serif";
const mono = "'Geist Mono', 'SF Mono', monospace";

// ── SVG Column Icon ──
const ColumnIcon = ({ size = 24, color = "#fff", strokeW = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="4" x2="18" y2="4" />
    <line x1="6" y1="20" x2="18" y2="20" />
    <rect x="8" y="4" width="3" height="16" rx="0.5" fill={color} fillOpacity="0.15" stroke={color} strokeWidth={strokeW} />
    <rect x="13" y="4" width="3" height="16" rx="0.5" fill={color} fillOpacity="0.15" stroke={color} strokeWidth={strokeW} />
  </svg>
);

// ── Minimal Column Mark ──
const ColumnMark = ({ size = 24, color = c.crimson }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="7" y="4" width="5" height="24" rx="1.5" fill={color} />
    <rect x="15" y="4" width="5" height="24" rx="1.5" fill={color} opacity="0.55" />
    <rect x="23" y="4" width="5" height="24" rx="1.5" fill={color} opacity="0.25" />
  </svg>
);

// ── Architectural Gate Mark ──
const GateMark = ({ size = 28, color = c.crimson }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="4" y="3" width="4.5" height="26" rx="1" fill={color} />
    <rect x="23.5" y="3" width="4.5" height="26" rx="1" fill={color} />
    <path d="M8.5 3 C8.5 3 16 1 23.5 3" stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none" />
    <rect x="13" y="12" width="6" height="17" rx="3" fill={color} opacity="0.2" />
  </svg>
);

// ── Stoa Colonnade Mark ──
const StoaMark = ({ size = 28, color = c.crimson, bg = "transparent" }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx={size * 0.22} fill={bg} />
    <line x1="5" y1="5.5" x2="27" y2="5.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <line x1="5" y1="26.5" x2="27" y2="26.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <rect x="7.5" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.9" />
    <rect x="14.25" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.55" />
    <rect x="21" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.3" />
  </svg>
);

export default function RossoStoaBrandKit() {
  const [mode, setMode] = useState("light");
  const dark = mode === "dark";

  const bg = dark ? c.g950 : c.white;
  const fg = dark ? c.g50 : c.g950;
  const muted = dark ? c.g500 : c.g400;
  const subtle = dark ? c.g400 : c.g500;
  const surface = dark ? c.g900 : c.g50;
  const border = dark ? c.g800 : c.g200;
  const borderSub = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  // ── Reusable Components ──
  const Label = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 500, color: muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12, fontFamily: f }}>{children}</div>
  );

  const Num = ({ n, title, desc }) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: c.crimson, fontFamily: mono }}>{n}</span>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: fg, margin: 0, letterSpacing: "-0.02em", fontFamily: f }}>{title}</h2>
      </div>
      <p style={{ fontSize: 13, color: subtle, margin: 0, lineHeight: 1.5, fontFamily: f, paddingLeft: 34 }}>{desc}</p>
    </div>
  );

  const Hr = () => <div style={{ height: 1, background: border, margin: "52px 0" }} />;

  const Swatch = ({ hex, name, sub, lg }) => {
    const lt = parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114 > 150;
    return (
      <div style={{ minWidth: lg ? 110 : 80 }}>
        <div style={{ background: hex, borderRadius: 10, height: lg ? 72 : 56, display: "flex", alignItems: "flex-end", padding: "0 8px 7px", border: (hex === "#FFFFFF" || hex === "#FAFAFA") ? `1px solid ${c.g200}` : "none" }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: lt ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.5)" }}>{hex}</span>
        </div>
        <div style={{ padding: "6px 2px 0" }}>
          <div style={{ fontSize: 11.5, fontWeight: 500, color: fg, fontFamily: f }}>{name}</div>
          {sub && <div style={{ fontSize: 10.5, color: muted, fontFamily: f }}>{sub}</div>}
        </div>
      </div>
    );
  };

  const Pill = ({ children, active, onClick }) => (
    <button onClick={onClick} style={{ background: active ? (dark ? c.white : c.g950) : "transparent", color: active ? (dark ? c.g950 : "#fff") : (dark ? c.g500 : c.g400), border: "none", borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: f, transition: "all 0.15s" }}>{children}</button>
  );

  const Btn = ({ v = "primary", children }) => {
    const base = { fontFamily: f, fontSize: 13, fontWeight: 500, padding: "7px 16px", borderRadius: 8, cursor: "pointer", border: "none", letterSpacing: "-0.01em" };
    const vs = {
      primary: { background: c.crimson, color: "#fff" },
      secondary: { background: dark ? c.g800 : c.g100, color: fg, border: `1px solid ${border}` },
      outline: { background: "transparent", color: fg, border: `1px solid ${border}` },
      ghost: { background: "transparent", color: subtle },
      destructive: { background: dark ? "rgba(224,30,55,0.1)" : "rgba(218,30,55,0.06)", color: c.crimson },
      link: { background: "transparent", color: c.crimson, padding: 0, textDecoration: "underline", textUnderlineOffset: "3px", textDecorationColor: "rgba(218,30,55,0.3)" },
    };
    return <button style={{ ...base, ...vs[v] }}>{children}</button>;
  };

  const Badge = ({ children, v = "default" }) => {
    const vs = {
      default: { bg: dark ? "rgba(224,30,55,0.1)" : "rgba(218,30,55,0.06)", color: c.crimson },
      success: { bg: dark ? "rgba(34,197,94,0.1)" : "rgba(34,197,94,0.06)", color: "#22C55E" },
      warning: { bg: dark ? "rgba(234,179,8,0.1)" : "rgba(234,179,8,0.06)", color: dark ? "#FACC15" : "#CA8A04" },
      neutral: { bg: dark ? c.g800 : c.g100, color: subtle },
    };
    return <span style={{ background: vs[v].bg, color: vs[v].color, fontFamily: f, fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 6 }}>{children}</span>;
  };

  // ── Logo Variants ──
  const LogoPrimary = ({ size = 28 }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <StoaMark size={size} color={c.crimson} />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={{ fontFamily: f, fontSize: size * 0.5, fontWeight: 700, color: fg, letterSpacing: "-0.04em", lineHeight: 1.1 }}>Rosso Stoa</span>
      </div>
    </div>
  );

  const LogoStacked = ({ size = 36 }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <StoaMark size={size} color={c.crimson} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: f, fontSize: size * 0.42, fontWeight: 700, color: fg, letterSpacing: "-0.04em", lineHeight: 1 }}>Rosso Stoa</div>
      </div>
    </div>
  );

  const LogoCompact = ({ size = 28 }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: size, height: size, borderRadius: size * 0.25, background: c.crimson, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: f, fontSize: size * 0.45, fontWeight: 700, color: "#fff", lineHeight: 1, marginTop: -1 }}>RS</span>
      </div>
      <span style={{ fontFamily: f, fontSize: size * 0.57, fontWeight: 600, color: fg, letterSpacing: "-0.04em" }}>Rosso Stoa</span>
    </div>
  );

  const LogoMonogram = ({ size = 36 }) => (
    <div style={{ width: size, height: size, borderRadius: size * 0.25, background: c.crimson, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: f, fontSize: size * 0.4, fontWeight: 700, color: "#fff", lineHeight: 1, marginTop: -1 }}>RS</span>
    </div>
  );

  const LogoMinimal = ({ size = 28 }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <StoaMark size={size} color={c.crimson} />
      <span style={{ fontFamily: f, fontSize: size * 0.57, fontWeight: 600, color: fg, letterSpacing: "-0.04em" }}>stoa</span>
    </div>
  );

  const LogoFull = ({ size = 28 }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <StoaMark size={size} color={c.crimson} />
      <div>
        <div style={{ fontFamily: f, fontSize: size * 0.5, fontWeight: 700, color: fg, letterSpacing: "-0.04em", lineHeight: 1.1 }}>Rosso Stoa</div>
        <div style={{ fontFamily: f, fontSize: size * 0.28, fontWeight: 400, color: muted, letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 1 }}>Property Management</div>
      </div>
    </div>
  );

  // ── Page Layout ──
  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
* { box-sizing: border-box; margin: 0; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.25); border-radius: 3px; }
`}</style>

      <div style={{ minHeight: "100vh", background: bg, fontFamily: f, transition: "background 0.2s, color 0.2s" }}>
        {/* ── Header ── */}
        <div style={{ position: "sticky", top: 0, zIndex: 100, background: dark ? "rgba(9,9,11,0.82)" : "rgba(255,255,255,0.82)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${border}`, padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StoaMark size={22} color={c.crimson} />
            <span style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: fg, letterSpacing: "-0.03em" }}>Rosso Stoa</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: dark ? c.g900 : c.g100, borderRadius: 999, padding: 2 }}>
            <Pill active={mode === "light"} onClick={() => setMode("light")}>Light</Pill>
            <Pill active={mode === "dark"} onClick={() => setMode("dark")}>Dark</Pill>
          </div>
        </div>

        <div style={{ maxWidth: 840, margin: "0 auto", padding: "52px 28px 80px" }}>
          {/* ── Hero ── */}
          <div style={{ marginBottom: 52 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: dark ? "rgba(218,30,55,0.08)" : "rgba(218,30,55,0.04)", border: `1px solid ${dark ? "rgba(218,30,55,0.15)" : "rgba(218,30,55,0.08)"}`, padding: "4px 12px", borderRadius: 999, marginBottom: 18 }}>
              <StoaMark size={12} color={c.crimson} />
              <span style={{ fontSize: 11.5, fontWeight: 500, color: c.crimson }}>Brand Identity System</span>
            </div>
            <h1 style={{ fontSize: 44, fontWeight: 700, color: fg, margin: "0 0 10px 0", letterSpacing: "-0.045em", lineHeight: 1.05 }}>Rosso Stoa</h1>
            <p style={{ fontSize: 15, color: subtle, margin: 0, lineHeight: 1.6, maxWidth: 460, letterSpacing: "-0.01em" }}>
              Mediterranean architecture meets modern SaaS. A brand system built on columns, crimson, and clean geometry for property management.
            </p>
          </div>

          <Hr />

          {/* ── 01 Logo System ── */}
          <Num n="01" title="Logo System" desc="Six treatments built from the colonnade mark — three columns with graduating opacity, framed by entablature lines." />

          <div style={{ marginBottom: 14 }}>
            <Label>The Mark</Label>
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              {[20, 28, 36, 48, 64].map(s => <StoaMark key={s} size={s} color={c.crimson} />)}
            </div>
            <p style={{ fontSize: 12, color: muted, fontFamily: f, lineHeight: 1.5, maxWidth: 500, marginTop: 8 }}>
              Three columns with graduating opacity (90% → 55% → 30%) suggest depth and perspective — a colonnade receding into space. Horizontal lines top and bottom reference the entablature and stylobate of a classical stoa.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 20, marginBottom: 12 }}>
            {[
              { label: "Primary", el: <LogoPrimary size={30} /> },
              { label: "Compact", el: <LogoCompact size={28} /> },
              { label: "Product Name", el: <LogoMinimal size={28} /> },
            ].map(({ label, el }) => (
              <div key={label} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                {el}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            {[
              { label: "Full Lockup", el: <LogoFull size={30} /> },
              { label: "Stacked", el: <LogoStacked size={40} /> },
              { label: "Monogram", el: <div style={{ display: "flex", gap: 12, alignItems: "center" }}><LogoMonogram size={36} /><LogoMonogram size={28} /><LogoMonogram size={22} /></div> },
            ].map(({ label, el }) => (
              <div key={label} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                {el}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: `linear-gradient(135deg, ${c.night}, ${c.cherry})`, borderRadius: 12, padding: 32, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.06em" }}>On Brand Gradient</span>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <StoaMark size={30} color="#fff" />
                <span style={{ fontFamily: f, fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.04em" }}>Rosso Stoa</span>
              </div>
            </div>
            <div style={{ background: dark ? c.g800 : c.g950, borderRadius: 12, padding: 32, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em" }}>On Dark</span>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <StoaMark size={30} color={c.crimson} />
                <span style={{ fontFamily: f, fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.04em" }}>Rosso Stoa</span>
              </div>
            </div>
          </div>

          <Hr />

          {/* ── 02 Alternate Marks ── */}
          <Num n="02" title="Alternate Marks" desc="Exploratory icons using column and gate architectural motifs." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              { label: "Colonnade (Primary)", el: <StoaMark size={40} color={c.crimson} /> },
              { label: "Columns — Gradient", el: <ColumnMark size={40} color={c.crimson} /> },
              { label: "Archway Gate", el: <GateMark size={40} color={c.crimson} /> },
            ].map(({ label, el }) => (
              <div key={label} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                {el}
                <span style={{ fontSize: 11, fontWeight: 500, color: muted, fontFamily: f, textAlign: "center" }}>{label}</span>
              </div>
            ))}
          </div>

          <Hr />

          {/* ── 03 Colors ── */}
          <Num n="03" title="Color Palette" desc="Crimson brand spectrum from Night Bordeaux to Scarlet Rush. Zinc neutrals for UI." />
          <div style={{ marginBottom: 24 }}>
            <Label>Brand Spectrum</Label>
            <div style={{ display: "flex", borderRadius: 12, overflow: "hidden", height: 64, marginBottom: 8 }}>
              {[c.night, c.burg, c.burgII, c.ruby, c.carmine, c.cherry, c.crimson, c.scarlet].map(hex => <div key={hex} style={{ flex: 1, background: hex }} />)}
            </div>
            <div style={{ display: "flex" }}>
              {["950", "900", "800", "700", "600", "500", "400", "300"].map(n => (
                <div key={n} style={{ flex: 1, textAlign: "center" }}><span style={{ fontSize: 10, color: muted, fontFamily: mono }}>{n}</span></div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 24 }}>
            <Label>Semantic</Label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Swatch hex={c.crimson} name="Primary" sub="CTA, links" lg />
              <Swatch hex="#22C55E" name="Success" sub="Paid, active" lg />
              <Swatch hex={dark ? "#FACC15" : "#CA8A04"} name="Warning" sub="Pending" lg />
              <Swatch hex={c.scarlet} name="Destructive" sub="Errors" lg />
              <Swatch hex={dark ? c.g50 : c.g950} name="Foreground" sub="Text" lg />
              <Swatch hex={dark ? c.g500 : c.g400} name="Muted" sub="Subtle" lg />
            </div>
          </div>
          <div>
            <Label>Neutrals — {dark ? "Dark" : "Light"}</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(dark
                ? [{ hex: c.g950, n: "BG" }, { hex: c.g900, n: "Card" }, { hex: c.g800, n: "Muted" }, { hex: c.g700, n: "Border" }, { hex: c.g500, n: "Muted FG" }, { hex: c.g50, n: "FG" }]
                : [{ hex: c.white, n: "BG" }, { hex: c.g50, n: "Card" }, { hex: c.g100, n: "Muted" }, { hex: c.g200, n: "Border" }, { hex: c.g500, n: "Muted FG" }, { hex: c.g950, n: "FG" }]
              ).map(({ hex, n }) => <Swatch key={n} hex={hex} name={n} />)}
            </div>
          </div>

          <Hr />

          {/* ── 04 Typography ── */}
          <Num n="04" title="Typography" desc="Geist Sans with tight tracking for headings. Geist Mono for financial data and identifiers." />
          <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 28, marginBottom: 12 }}>
            {[
              { s: 36, w: 700, l: "Display", t: "-0.045em" },
              { s: 28, w: 600, l: "H1", t: "-0.035em" },
              { s: 22, w: 600, l: "H2", t: "-0.025em" },
              { s: 18, w: 600, l: "H3", t: "-0.02em" },
              { s: 15, w: 500, l: "H4", t: "-0.01em" },
            ].map(({ s, w, l, t }) => (
              <div key={l} style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: muted, width: 52, textAlign: "right", fontFamily: mono, flexShrink: 0 }}>{l}</span>
                <span style={{ fontSize: s, fontWeight: w, color: fg, letterSpacing: t, fontFamily: f, lineHeight: 1.2 }}>Rosso Stoa</span>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 16, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: muted, width: 52, textAlign: "right", fontFamily: mono, flexShrink: 0 }}>Body</span>
                <span style={{ fontSize: 14, color: fg, lineHeight: 1.6, fontFamily: f }}>Rosso Stoa streamlines property management — tenant communication, maintenance tracking, and financial reporting, all under one colonnade.</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 20 }}>
              <Label>Weights</Label>
              {[{ w: 400, l: "Regular — body" }, { w: 500, l: "Medium — labels, nav" }, { w: 600, l: "Semibold — headings" }, { w: 700, l: "Bold — display" }].map(({ w, l }) => (
                <div key={w} style={{ marginBottom: 6, display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 10, color: muted, fontFamily: mono, width: 24 }}>{w}</span>
                  <span style={{ fontSize: 13, fontWeight: w, color: fg, fontFamily: f }}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 20 }}>
              <Label>Geist Mono</Label>
              <p style={{ fontSize: 12, color: subtle, fontFamily: f, margin: "0 0 10px" }}>Financial data, IDs, and code.</p>
              {["$2,400.00", "₲3,200,000", "UNIT-4B-102", "INV-2026-0042"].map(t => (
                <div key={t} style={{ fontSize: 13, fontFamily: mono, color: fg, marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>{t}</div>
              ))}
            </div>
          </div>

          <Hr />

          {/* ── 05 Components ── */}
          <Num n="05" title="Components" desc="Buttons, badges, and inputs themed for Rosso Stoa." />
          <div style={{ marginBottom: 24 }}>
            <Label>Buttons</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Btn>Add Property</Btn>
              <Btn v="secondary">Secondary</Btn>
              <Btn v="outline">Outline</Btn>
              <Btn v="ghost">Ghost</Btn>
              <Btn v="destructive">Delete</Btn>
              <Btn v="link">View details</Btn>
            </div>
          </div>
          <div style={{ marginBottom: 24 }}>
            <Label>Badges</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge>Overdue</Badge>
              <Badge v="success">Paid</Badge>
              <Badge v="warning">Pending</Badge>
              <Badge v="neutral">Draft</Badge>
            </div>
          </div>
          <div>
            <Label>Inputs</Label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[{ l: "Property Name", p: "e.g. Sunset Villa" }, { l: "Monthly Rent", p: "$0.00" }].map(({ l, p }) => (
                <div key={l}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: fg, marginBottom: 5, fontFamily: f }}>{l}</div>
                  <div style={{ background: dark ? c.g900 : c.white, border: `1px solid ${border}`, borderRadius: 8, padding: "8px 12px", fontFamily: f, fontSize: 13, color: muted, width: 200 }}>{p}</div>
                </div>
              ))}
            </div>
          </div>

          <Hr />

          {/* ── 06 App Patterns ── */}
          <Num n="06" title="Application Patterns" desc="Dashboard stats, data tables, sidebar navigation, and property cards." />
          <div style={{ marginBottom: 20 }}>
            <Label>Stat Cards</Label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { l: "Total Revenue", v: "$48,250", ch: "12.5%", up: true },
                { l: "Occupancy", v: "94%", ch: "2.1%", up: true },
                { l: "Open Tickets", v: "7", ch: "3", up: false },
              ].map(({ l, v, ch, up }) => (
                <div key={l} style={{ background: dark ? c.g900 : c.white, border: `1px solid ${border}`, borderRadius: 12, padding: 18, flex: 1, minWidth: 155 }}>
                  <div style={{ fontSize: 12, color: subtle, fontFamily: f, fontWeight: 500, marginBottom: 8 }}>{l}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 26, fontWeight: 600, color: fg, fontFamily: f, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{v}</span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: up ? "#22C55E" : c.crimson, fontFamily: f }}>{up ? "↑" : "↓"} {ch}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <Label>Data Table</Label>
            <div style={{ background: dark ? c.g900 : c.white, border: `1px solid ${border}`, borderRadius: 12, padding: "4px 18px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr", padding: "10px 0", borderBottom: `1px solid ${border}` }}>
                {["Property", "Tenant", "Status", "Amount"].map((h, i) => (
                  <div key={h} style={{ fontSize: 11, fontWeight: 500, color: muted, fontFamily: f, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: i === 3 ? "right" : "left" }}>{h}</div>
                ))}
              </div>
              {[
                { p: "Sunset Villa, 4B", t: "Maria Garcia", s: "Paid", a: "$2,400" },
                { p: "Park Tower, 12A", t: "James Chen", s: "Pending", a: "$3,100" },
                { p: "Riverside, 2C", t: "Ana López", s: "Overdue", a: "$1,850" },
              ].map(({ p, t, s, a }, i) => (
                <div key={p} style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr", padding: "10px 0", borderBottom: i < 2 ? `1px solid ${borderSub}` : "none", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: fg, fontFamily: f }}>{p}</div>
                  <div style={{ fontSize: 13, color: subtle, fontFamily: f }}>{t}</div>
                  <div><Badge v={s === "Paid" ? "success" : s === "Pending" ? "warning" : "default"}>{s}</Badge></div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: fg, fontFamily: mono, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Sidebar + Property Card</Label>
            <div style={{ display: "flex", gap: 14 }}>
              {/* Sidebar */}
              <div style={{ width: 220, background: dark ? c.g900 : c.night, borderRadius: 12, padding: "16px 10px" }}>
                <div style={{ padding: "4px 10px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <StoaMark size={20} color={dark ? c.crimson : "rgba(255,255,255,0.8)"} />
                  <span style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: "#fff", letterSpacing: "-0.03em" }}>Rosso Stoa</span>
                </div>
                {["Dashboard", "Properties", "Tenants", "Payments", "Maintenance", "Settings"].map((l, i) => (
                  <div key={l} style={{ padding: "7px 10px", borderRadius: 7, fontSize: 13, fontWeight: i === 0 ? 500 : 400, color: i === 0 ? "#fff" : (dark ? c.g400 : "rgba(255,255,255,0.5)"), background: i === 0 ? (dark ? c.g800 : "rgba(255,255,255,0.1)") : "transparent", fontFamily: f, cursor: "pointer", marginBottom: 1 }}>{l}</div>
                ))}
              </div>
              {/* Property Card */}
              <div style={{ background: dark ? c.g900 : c.white, border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", width: 240 }}>
                <div style={{ height: 96, background: `linear-gradient(135deg, ${c.night}, ${c.cherry})`, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <StoaMark size={32} color="rgba(255,255,255,0.2)" />
                  <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", borderRadius: 6, padding: "3px 8px", fontSize: 10.5, fontWeight: 500, color: "#fff", fontFamily: f }}>Active</div>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: fg, fontFamily: f, letterSpacing: "-0.01em", marginBottom: 2 }}>Sunset Villa, 4B</div>
                  <div style={{ fontSize: 12, color: muted, fontFamily: f, marginBottom: 12 }}>1428 Elm Street, Asunción</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 18, fontWeight: 600, color: fg, fontFamily: f, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>₲3,200,000</span>
                    <span style={{ fontSize: 11, color: muted, fontFamily: f }}>/month</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Hr />

          {/* ── 07 Gradients ── */}
          <Num n="07" title="Gradients & Surfaces" desc="Four gradient treatments — hero, primary, dark sidebar, and subtle brand tint." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { from: c.night, to: c.cherry, l: "Primary", a: "135deg" },
              { from: c.burg, to: c.scarlet, l: "Hero", a: "to right" },
              { from: c.night, to: dark ? c.g950 : "#0F0F12", l: "Sidebar / Dark", a: "180deg" },
              { from: dark ? "rgba(218,30,55,0.06)" : "rgba(218,30,55,0.03)", to: dark ? "rgba(218,30,55,0.02)" : "rgba(218,30,55,0.01)", l: "Subtle Tint", a: "135deg", lt: true },
            ].map(({ from, to, l, a, lt }) => (
              <div key={l} style={{ background: `linear-gradient(${a}, ${from}, ${to})`, borderRadius: 10, height: 80, display: "flex", alignItems: "flex-end", padding: 14, border: lt ? `1px solid ${border}` : "none" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: lt ? fg : "#fff", fontFamily: f }}>{l}</span>
              </div>
            ))}
          </div>

          <Hr />

          {/* ── 08 CSS Variables ── */}
          <Num n="08" title="CSS Variables" desc={`shadcn/ui tokens — ${dark ? "dark" : "light"} mode. Toggle to see both.`} />
          <div style={{ background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", border: `1px solid ${border}`, borderRadius: 12, padding: 22, fontFamily: mono, fontSize: 11.5, lineHeight: 1.9, color: subtle, overflowX: "auto" }}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{dark ? `.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 7%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 7%;
  --popover-foreground: 0 0% 98%;
  --primary: 349 79% 49%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 349 82% 49%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 349 79% 49%;
  --radius: 0.625rem;
  --sidebar: 240 6% 6%;
  --sidebar-foreground: 0 0% 98%;
  --sidebar-primary: 349 79% 49%;
  --sidebar-accent: 240 3.7% 12%;
  --sidebar-border: 240 3.7% 15.9%;
}` : `:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 98%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 349 79% 49%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 349 82% 49%;
  --destructive-foreground: 0 0% 100%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 349 79% 49%;
  --radius: 0.625rem;
  --sidebar: 349 68% 12%;
  --sidebar-foreground: 0 0% 98%;
  --sidebar-primary: 349 79% 49%;
  --sidebar-accent: 349 68% 19%;
  --sidebar-border: 349 50% 18%;
}`}
            </pre>
          </div>

          <Hr />

          {/* ── 09 Principles ── */}
          <Num n="09" title="Design Principles" desc="Four rules that keep Rosso Stoa clean and consistent." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { t: "Architectural Restraint", b: "The colonnade mark is the only decorative element. Everything else is purely functional." },
              { t: "Crimson as Punctuation", b: "Red appears only for primary actions, the logo, and key data highlights. Never decorative." },
              { t: "One Typeface", b: "Geist Sans for everything. Geist Mono for data. Hierarchy through weight and tracking." },
              { t: "Invisible Borders", b: "1px at low opacity. No drop shadows on cards. Whitespace defines structure." },
            ].map(({ t, b }) => (
              <div key={t} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: fg, fontFamily: f, letterSpacing: "-0.01em", marginBottom: 4 }}>{t}</div>
                <div style={{ fontSize: 13, color: subtle, fontFamily: f, lineHeight: 1.5 }}>{b}</div>
              </div>
            ))}
          </div>

          {/* ── Footer ── */}
          <div style={{ textAlign: "center", paddingTop: 48, marginTop: 52, borderTop: `1px solid ${border}` }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <StoaMark size={18} color={c.crimson} />
              <span style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: fg, letterSpacing: "-0.03em" }}>Rosso Stoa</span>
            </div>
            <p style={{ fontSize: 11, color: muted, marginTop: 8, fontFamily: f }}>rossostoa.com · Property Management · 2026</p>
          </div>
        </div>
      </div>
    </>
  );
}
