import { useState, useEffect, useMemo, useCallback } from "react";

/* ============================================================
   THE DAILY COMPILE — editorial front-end for a multi-model
   daily brief pipeline. Renders edition JSON (S3-shaped),
   owns human-side state: topics, sources, feedback.
   ============================================================ */

/* ---------- Design tokens ----------
   paper  #F6F5F1  cool paper, not cream
   ink    #16150F  near-black ink
   wire   #1F3FAE  "wire blue" accent (links, active)
   rule   #D8D6CE  hairline
   up     #1D6B45  market green (semantic only)
   down   #9E2B25  market red   (semantic only)
*/

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,700;1,6..72,400;1,6..72,600&family=Archivo+Narrow:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

:root{
  --paper:#F6F5F1; --ink:#16150F; --ink-soft:#4A4840;
  --wire:#1F3FAE; --rule:#D8D6CE; --rule-dark:#16150F;
  --up:#1D6B45; --down:#9E2B25; --neutral:#6B6858;
  --serif:'Newsreader', Georgia, serif;
  --label:'Archivo Narrow', 'Arial Narrow', sans-serif;
  --mono:'IBM Plex Mono', ui-monospace, monospace;
}
*{box-sizing:border-box; margin:0; padding:0;}
.dc-root{background:var(--paper); color:var(--ink); font-family:var(--serif);
  min-height:100vh; font-size:17px; line-height:1.5;}
.dc-shell{max-width:1080px; margin:0 auto; padding:0 20px 80px;}

/* Masthead */
.dc-mast{padding:26px 0 14px; text-align:center; border-bottom:3px double var(--rule-dark);}
.dc-mast-top{font-family:var(--mono); font-size:11px; letter-spacing:.08em;
  color:var(--ink-soft); display:flex; justify-content:space-between; margin-bottom:14px;}
.dc-mast h1{font-family:var(--serif); font-weight:700; font-size:clamp(34px,7vw,58px);
  letter-spacing:-.01em; line-height:1; text-transform:uppercase;}
.dc-mast h1 .amp{font-style:italic; font-weight:400;}
.dc-mast-sub{font-family:var(--label); font-size:12px; letter-spacing:.22em;
  text-transform:uppercase; color:var(--ink-soft); margin-top:10px;}

/* Section nav */
.dc-nav{display:flex; justify-content:center; gap:0; border-bottom:1px solid var(--rule-dark);
  overflow-x:auto; -webkit-overflow-scrolling:touch;}
.dc-nav button{appearance:none; background:none; border:none; cursor:pointer;
  font-family:var(--label); font-size:13px; letter-spacing:.18em; text-transform:uppercase;
  padding:12px 18px; color:var(--ink-soft); border-bottom:3px solid transparent;
  white-space:nowrap;}
.dc-nav button.on{color:var(--ink); border-bottom-color:var(--wire); font-weight:700;}
.dc-nav button:focus-visible{outline:2px solid var(--wire); outline-offset:-2px;}

/* Edition header */
.dc-edhead{display:flex; justify-content:space-between; align-items:baseline;
  padding:16px 0 6px; font-family:var(--mono); font-size:12px; color:var(--ink-soft);}
.dc-edhead b{color:var(--ink); font-weight:500;}

/* Lead story */
.dc-lead{padding:22px 0 26px; border-bottom:1px solid var(--rule-dark);}
.dc-lead h2{font-size:clamp(26px,4.5vw,40px); font-weight:500; line-height:1.12;
  letter-spacing:-.01em; max-width:22ch;}
.dc-lead .dek{font-style:italic; font-size:19px; color:var(--ink-soft); margin-top:10px; max-width:60ch;}

/* Topic sections + story grid */
.dc-section-h{display:flex; align-items:center; gap:14px; margin:30px 0 4px;}
.dc-section-h span{font-family:var(--label); font-size:13px; font-weight:700;
  letter-spacing:.24em; text-transform:uppercase;}
.dc-section-h::after{content:""; flex:1; height:1px; background:var(--rule-dark);}
.dc-grid{display:grid; grid-template-columns:1fr; }
@media(min-width:760px){ .dc-grid{grid-template-columns:1fr 1fr;} }
.dc-story{padding:20px 0; border-bottom:1px solid var(--rule);}
@media(min-width:760px){
  .dc-story{padding:20px 24px;}
  .dc-story:nth-child(odd){border-right:1px solid var(--rule); padding-left:0;}
  .dc-story:nth-child(even){padding-right:0;}
}
.dc-eyebrow{display:flex; align-items:center; gap:10px; margin-bottom:8px;}
.dc-eyebrow .topic{font-family:var(--label); font-size:11px; font-weight:700;
  letter-spacing:.2em; text-transform:uppercase; color:var(--wire);}
.dc-story h3{font-size:22px; font-weight:500; line-height:1.18; letter-spacing:-.005em;}
.dc-story .dek{font-style:italic; color:var(--ink-soft); margin-top:6px; font-size:16px;}
.dc-body{margin-top:10px; font-size:16.5px; color:var(--ink);}
.dc-body p{margin-top:8px;}
.dc-wim{margin-top:12px; padding-left:12px; border-left:2px solid var(--wire); font-size:15.5px;}
.dc-wim b{font-family:var(--label); font-size:11px; letter-spacing:.18em;
  text-transform:uppercase; display:block; color:var(--wire); margin-bottom:2px;}
.dc-more{appearance:none; background:none; border:none; cursor:pointer; padding:0;
  font-family:var(--label); font-size:12px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--wire); margin-top:10px; border-bottom:1px solid currentColor;}

/* Colophon: provenance + sources + feedback */
.dc-colophon{margin-top:14px; padding-top:10px; border-top:1px dotted var(--rule);
  display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center;
  font-family:var(--mono); font-size:11.5px; color:var(--ink-soft);}
.dc-model{display:inline-flex; align-items:center; gap:6px;}
.dc-model .glyph{width:9px; height:9px; display:inline-block; border:1px solid var(--ink);}
.glyph-claude{border-radius:50%; background:var(--ink);}
.glyph-gpt{background:transparent;}
.glyph-grok{transform:rotate(45deg); background:var(--ink-soft); border:none; width:8px; height:8px;}
.dc-src a{color:var(--ink-soft); text-decoration:none; border-bottom:1px solid var(--rule);}
.dc-src a:hover{color:var(--wire); border-color:var(--wire);}
.dc-sent{font-weight:500;}
.dc-sent.bullish{color:var(--up);} .dc-sent.bearish{color:var(--down);} .dc-sent.neutral{color:var(--neutral);}

.dc-fb{margin-left:auto; display:flex; gap:8px;}
.dc-fb button{appearance:none; cursor:pointer; background:none;
  border:1px solid var(--rule-dark); padding:4px 10px;
  font-family:var(--label); font-size:11px; font-weight:600; letter-spacing:.12em;
  text-transform:uppercase; color:var(--ink);}
.dc-fb button:hover{background:var(--ink); color:var(--paper);}
.dc-fb button.on-keep{background:var(--up); border-color:var(--up); color:#fff;}
.dc-fb button.on-spike{background:var(--down); border-color:var(--down); color:#fff;
  text-decoration:line-through;}

/* Archive */
.dc-arch{list-style:none;}
.dc-arch li{border-bottom:1px solid var(--rule);}
.dc-arch button{appearance:none; width:100%; text-align:left; background:none; border:none;
  cursor:pointer; padding:18px 4px; font-family:var(--serif); display:block;}
.dc-arch button:hover h4{color:var(--wire);}
.dc-arch .d{font-family:var(--mono); font-size:11.5px; color:var(--ink-soft); letter-spacing:.05em;}
.dc-arch h4{font-size:20px; font-weight:500; line-height:1.25; margin-top:4px; color:var(--ink);}
.dc-arch .m{font-family:var(--label); font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--ink-soft); margin-top:6px;}

/* Desk (settings) */
.dc-desk h3{font-family:var(--label); font-size:14px; font-weight:700; letter-spacing:.2em;
  text-transform:uppercase; margin:30px 0 4px; display:flex; align-items:center; gap:14px;}
.dc-desk h3::after{content:""; flex:1; height:1px; background:var(--rule-dark);}
.dc-desk .hint{font-style:italic; color:var(--ink-soft); font-size:15px; margin-bottom:12px;}
.dc-row{display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--rule);
  flex-wrap:wrap;}
.dc-row .name{font-size:17px; flex:1; min-width:140px;}
.dc-row .name small{font-family:var(--mono); font-size:11px; color:var(--ink-soft); display:block;}
.dc-pill{appearance:none; cursor:pointer; background:none; border:1px solid var(--rule-dark);
  font-family:var(--label); font-size:11px; font-weight:600; letter-spacing:.1em;
  text-transform:uppercase; padding:4px 10px; color:var(--ink);}
.dc-pill.on{background:var(--ink); color:var(--paper);}
.dc-pill.warn.on{background:var(--down); border-color:var(--down);}
.dc-pill.good.on{background:var(--up); border-color:var(--up);}
.dc-x{appearance:none; cursor:pointer; background:none; border:none; color:var(--down);
  font-family:var(--mono); font-size:14px; padding:2px 6px;}
.dc-add{display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;}
.dc-add input, .dc-add select, .dc-import textarea{font-family:var(--mono); font-size:13px;
  padding:8px 10px; border:1px solid var(--rule-dark); background:#fff; color:var(--ink);}
.dc-add input{flex:1; min-width:160px;}
.dc-add input:focus, .dc-import textarea:focus{outline:2px solid var(--wire); outline-offset:-1px;}
.dc-btn{appearance:none; cursor:pointer; background:var(--ink); color:var(--paper); border:none;
  font-family:var(--label); font-size:12px; font-weight:700; letter-spacing:.16em;
  text-transform:uppercase; padding:9px 18px;}
.dc-btn.ghost{background:none; color:var(--ink); border:1px solid var(--rule-dark);}
.dc-import textarea{width:100%; min-height:110px; margin-top:8px;}
.dc-note{font-family:var(--mono); font-size:11.5px; margin-top:8px;}
.dc-note.ok{color:var(--up);} .dc-note.err{color:var(--down);}
pre.dc-export{font-family:var(--mono); font-size:11.5px; background:#fff;
  border:1px solid var(--rule-dark); padding:12px; margin-top:10px; overflow-x:auto;
  max-height:280px; white-space:pre-wrap; word-break:break-word;}

/* Market pages (stocks / options) */
.dc-mkt-head{display:flex; justify-content:space-between; align-items:baseline; margin:24px 0 4px; flex-wrap:wrap; gap:6px;}
.dc-mkt-head h2{font-size:clamp(22px,4vw,30px); font-weight:500;}
.dc-mkt-head .tag{font-family:var(--label); font-size:11px; font-weight:700; letter-spacing:.18em;
  text-transform:uppercase; color:var(--paper); background:var(--ink); padding:3px 8px;}
.dc-tablewrap{overflow-x:auto; border-top:1px solid var(--rule-dark); -webkit-overflow-scrolling:touch;}
table.dc-tab{border-collapse:collapse; width:100%; min-width:680px; font-size:14px;}
.dc-tab th{font-family:var(--label); font-size:11px; font-weight:700; letter-spacing:.14em;
  text-transform:uppercase; text-align:left; padding:10px 10px; border-bottom:1px solid var(--rule-dark);
  color:var(--ink-soft); white-space:nowrap;}
.dc-tab td{padding:10px; border-bottom:1px solid var(--rule); vertical-align:top;}
.dc-tab .num{font-family:var(--mono); font-size:12.5px; white-space:nowrap;}
.dc-tab .tick{position:sticky; left:0; background:var(--paper); font-family:var(--mono);
  font-weight:500; font-size:13px; z-index:1;}
.dc-tab .tick small{display:block; font-family:var(--serif); font-style:italic; font-weight:400;
  color:var(--ink-soft); font-size:12px; white-space:nowrap;}
.dc-tab .pos{color:var(--up);} .dc-tab .neg{color:var(--down);}
.dc-conv{font-family:var(--label); font-size:10.5px; font-weight:700; letter-spacing:.1em;
  text-transform:uppercase; padding:2px 7px; border:1px solid var(--rule-dark); white-space:nowrap;}
.dc-conv.high{background:var(--ink); color:var(--paper);}
.dc-conv.low{color:var(--ink-soft); border-color:var(--rule);}
.dc-tab tr.dc-exp-toggle{cursor:pointer;}
.dc-tab tr.dc-exp-toggle:hover td{background:#EFEEE8;}
.dc-exp td{background:#FCFBF8; font-size:15px; padding:14px 12px; border-bottom:1px solid var(--rule-dark);}
.dc-exp .why{font-style:italic;}
.dc-exp a{color:var(--wire); font-family:var(--mono); font-size:11.5px; text-decoration:none;
  border-bottom:1px solid currentColor;}
.dc-mkt-note{font-family:var(--mono); font-size:11px; color:var(--ink-soft); margin-top:12px; line-height:1.6;}
.dc-snaps{margin-top:34px;}

.dc-foot{margin-top:60px; padding-top:14px; border-top:3px double var(--rule-dark);
  text-align:center; font-family:var(--mono); font-size:11px; color:var(--ink-soft);
  letter-spacing:.05em;}
.dc-empty{padding:40px 0; text-align:center; font-style:italic; color:var(--ink-soft);}
@media (prefers-reduced-motion: no-preference){
  .dc-story, .dc-lead{animation:dcfade .35s ease both;}
  @keyframes dcfade{from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:none;}}
}
`;

/* ---------- Default pipeline config (topics + sources) ---------- */
const DEFAULT_CONFIG = {
  briefName: "The Daily Compile",
  topics: [
    { slug: "ai", label: "AI & Models", weight: "high", enabled: true },
    { slug: "markets", label: "Markets", weight: "normal", enabled: true },
    { slug: "chips", label: "Chips & Hardware", weight: "high", enabled: true },
    { slug: "oss", label: "GitHub & Open Source", weight: "normal", enabled: true },
    { slug: "funding", label: "Funding & Deals", weight: "low", enabled: true },
  ],
  sources: [
    { domain: "reuters.com", trust: "preferred" },
    { domain: "sec.gov", trust: "preferred" },
    { domain: "bloomberg.com", trust: "allowed" },
    { domain: "techcrunch.com", trust: "allowed" },
    { domain: "news.ycombinator.com", trust: "allowed" },
  ],
};

/* ---------- Mock editions (S3 contract shape) ---------- */
const MOCK_EDITIONS = [
  {
    date: "2026-07-17", edition: 26,
    pipeline: { candidates: ["claude-fable-5", "gpt-5.6-terra", "grok-4.5"], judge: "local-llama-70b" },
    lead: {
      id: "e26-lead", topic: "chips", model: "claude", judgeScore: 9.1, sentiment: "bearish",
      headline: "Apple reclaims the crown as the chip rout deepens",
      dek: "Nvidia cedes the world's-most-valuable title in a second day of AI-fatigue selling; oil tops $80 and rotation favors energy and financials.",
      body: ["A broad semiconductor de-rating dragged NVDA, AMD and INTC lower while Apple's steadiness pushed its market cap back to the top near $4.9T. TSMC's record quarter and a capex hike to ~$62B failed to arrest the slide — investors read spend, not strength.",
        "Energy caught the rotation bid as Middle East supply threats sent crude through $80, lifting XOM and CVX roughly 3%."],
      whyItMatters: "Two straight sessions of selling into good chip news suggests positioning, not fundamentals, is driving the tape. Watch next week's mega-cap earnings for confirmation.",
      sources: [
        { title: "Why Nvidia sank", url: "https://www.fool.com/investing/2026/07/17/why-did-nvidia-stock-sink-today/" },
        { title: "TSMC Q2 filing", url: "https://www.sec.gov/Archives/edgar/data/0001046179/000104617926000451/a2q26e_withguidancexfinal.htm" },
      ],
    },
    stories: [
      { id: "e26-s1", topic: "ai", model: "gpt", judgeScore: 8.4, sentiment: "neutral",
        headline: "Palantir leads software lower as AI names de-rate",
        dek: "Down ~7% on no company news — a pure multiple-compression move.",
        body: ["High-multiple AI software took the brunt of the rotation, with PLTR the standout decliner. Oracle slid separately after its annual report disclosed a ~13% headcount reduction."],
        whyItMatters: "When leaders fall without headlines, it's the crowd leaving, not the story changing.",
        sources: [{ title: "Yahoo Finance", url: "https://finance.yahoo.com/markets/stocks/articles/palantir-down-7-today-underperforming-164011831.html" }] },
      { id: "e26-s2", topic: "chips", model: "claude", judgeScore: 8.9, sentiment: "bullish",
        headline: "Micron bucks the rout on record DRAM pricing",
        dek: "MU up ~3.3% while the rest of the complex bleeds.",
        body: ["The AI-driven memory shortage keeps rewarding the one part of the chip stack with genuine scarcity pricing. Record DRAM contract prices lifted Micron against a deeply red tape."],
        whyItMatters: "Memory is the tightest link in the AI supply chain — pricing power there is real, not narrative.",
        sources: [{ title: "24/7 Wall St", url: "https://247wallst.com/technology-3/2026/07/17/micron-technology-record-dram-pricing-meets-a-stock-in-retreat/" }] },
      { id: "e26-s3", topic: "markets", model: "grok", judgeScore: 7.8, sentiment: "bearish",
        headline: "Netflix beats, guides soft, drops 7%",
        dek: "Q2 beat wasn't enough against elevated expectations.",
        body: ["Netflix delivered a Q2 beat but soft Q3 guidance sent shares down roughly 7% — the classic late-cycle pattern of good news priced as insufficient."],
        whyItMatters: "Guidance, not results, is setting prices this earnings season.",
        sources: [{ title: "Motley Fool", url: "https://www.fool.com/investing/2026/07/17/netflix-beat-estimates-but-the-stock-dropped/" }] },
      { id: "e26-s4", topic: "markets", model: "claude", judgeScore: 8.1, sentiment: "bullish",
        headline: "Palo Alto leads security higher on Capital One upgrade",
        dek: "Cybersecurity as the defensive corner of tech.",
        body: ["PANW rose ~2.5% on an upgrade while most enterprise software drifted lower, extending the pattern of security spending holding up when everything else gets questioned."],
        whyItMatters: "Security budgets are the last thing CIOs cut — the market is treating the sector accordingly.",
        sources: [{ title: "Seeking Alpha", url: "https://seekingalpha.com/news/4614971-palo-alto-leads-security-stocks-up-while-most-enterprise-software-names-inch-down" }] },
    ],
    stocks: { updated: "post-close", picks: [
      { ticker: "NVDA", company: "NVIDIA", sector: "Semis", price: 201.60, scenarios: { "3m": -2, "6m": 3, "12m": 12, "18m": 18, "24m": 22 }, conviction: "med", sentiment: "bearish",
        reason: "Chip rout deepens; NVDA slips ~3.8% and cedes the most-valuable crown to Apple.", sourceUrl: "https://www.fool.com/investing/2026/07/17/why-did-nvidia-stock-sink-today/" },
      { ticker: "TSM", company: "Taiwan Semiconductor", sector: "Semis", price: 398.37, scenarios: { "3m": 0, "6m": 5, "12m": 14, "18m": 18, "24m": 22 }, conviction: "med", sentiment: "neutral",
        reason: "Record Q2 (+77% net income) and capex hike to ~$62B, but the ADR still falls on AI fatigue.", sourceUrl: "https://www.sec.gov/Archives/edgar/data/0001046179/000104617926000451/a2q26e_withguidancexfinal.htm" },
      { ticker: "MU", company: "Micron Technology", sector: "Semis", price: null, scenarios: { "3m": 4, "6m": 8, "12m": 14, "18m": 15, "24m": 18 }, conviction: "med", sentiment: "bullish",
        reason: "Record DRAM pricing lifts MU ~3.3%, bucking the semiconductor rout.", sourceUrl: "https://247wallst.com/technology-3/2026/07/17/micron-technology-record-dram-pricing-meets-a-stock-in-retreat/" },
      { ticker: "AMD", company: "Advanced Micro Devices", sector: "Semis", price: 477.81, scenarios: { "3m": -4, "6m": 2, "12m": 10, "18m": 15, "24m": 18 }, conviction: "low", sentiment: "bearish",
        reason: "Among the hardest-hit chips, down ~5% in the semiconductor rotation.", sourceUrl: "https://247wallst.com/investing/2026/07/17/amd-falls-5-intel-drops-4-nvidia-slides-3-before-recovering-as-rotation-hits-semiconductor-stocks/" },
      { ticker: "AAPL", company: "Apple", sector: "Hardware", price: 333.65, scenarios: { "3m": 2, "6m": 5, "12m": 10, "18m": 12, "24m": 14 }, conviction: "med", sentiment: "bullish",
        reason: "Reclaims the world's-most-valuable title (~$4.91T) as Nvidia slips.", sourceUrl: "https://www.thestreet.com/stock-market-today/stock-market-today-dow-jones-sp-500-nasdaq-updates-july-17-2026" },
      { ticker: "GOOGL", company: "Alphabet", sector: "Hyperscale", price: 354.46, scenarios: { "3m": 1, "6m": 5, "12m": 12, "18m": 16, "24m": 18 }, conviction: "med", sentiment: "neutral",
        reason: "Drops with the comms sector; Q2 earnings due July 22.", sourceUrl: "https://www.interactivecrypto.com/spy-edges-lower-as-tech-stocks-falter-amid-sector-rotation-to-healthcare-and-financials-on-july" },
      { ticker: "AMZN", company: "Amazon.com", sector: "Hyperscale", price: 256.87, scenarios: { "3m": 2, "6m": 6, "12m": 12, "18m": 16, "24m": 18 }, conviction: "med", sentiment: "neutral",
        reason: "Edges up ~0.75%, resisting the broad tech decline.", sourceUrl: "https://www.thestreet.com/stock-market-today/stock-market-today-dow-jones-sp-500-nasdaq-updates-july-17-2026" },
      { ticker: "PLTR", company: "Palantir Technologies", sector: "Software", price: null, scenarios: { "3m": -6, "6m": -2, "12m": 6, "18m": 8, "24m": 10 }, conviction: "low", sentiment: "bearish",
        reason: "Leads software lower, down ~7% as AI names de-rate.", sourceUrl: "https://finance.yahoo.com/markets/stocks/articles/palantir-down-7-today-underperforming-164011831.html" },
      { ticker: "NFLX", company: "Netflix", sector: "Media", price: 68.95, scenarios: { "3m": -2, "6m": 3, "12m": 9, "18m": 12, "24m": 14 }, conviction: "low", sentiment: "bearish",
        reason: "Sinks ~7% despite a Q2 beat on soft Q3 guidance.", sourceUrl: "https://www.fool.com/investing/2026/07/17/netflix-beat-estimates-but-the-stock-dropped/" },
      { ticker: "XOM", company: "ExxonMobil", sector: "Energy", price: 141.62, scenarios: { "3m": 3, "6m": 3, "12m": 5, "18m": 6, "24m": 7 }, conviction: "med", sentiment: "bullish",
        reason: "Jumps ~3.3% as oil tops $80 on Middle East supply threats.", sourceUrl: "https://stockstory.org/us/stocks/nyse/xom/news/why-up-down/exxonmobil-and-chevron-shares-skyrocket-what-you-need-to-know" },
    ]},
    options: { updated: "post-close", ideas: [
      { ticker: "NVDA", company: "NVIDIA", strategy: "LEAPS Call", tag: "aggressive", direction: "bull", dte: 365, spot: 201.60, framing: "~$225 (+12%, near 12m mid)", maxLoss: "$2,500", aggressiveCase: "~+248%", probability: "low-med" },
      { ticker: "NVDA", company: "NVIDIA", strategy: "Bull Call Spread", tag: "defined risk", direction: "bull", dte: 180, spot: 201.60, framing: "205 / 265", maxLoss: "$1,800", aggressiveCase: "~+233%", probability: "med" },
      { ticker: "TSM", company: "Taiwan Semi", strategy: "LEAPS Call", tag: "aggressive", direction: "bull", dte: 365, spot: 398.37, framing: "~$455 (+14%, near 12m mid)", maxLoss: "$4,200", aggressiveCase: "~+221%", probability: "low-med" },
      { ticker: "AMD", company: "Advanced Micro Devices", strategy: "Bear Put Spread", tag: "defined risk", direction: "bear", dte: 120, spot: 477.81, framing: "392 / 335", maxLoss: "$1,800", aggressiveCase: "~+217%", probability: "low-med" },
      { ticker: "AAPL", company: "Apple", strategy: "Cash-Secured Put", tag: "income/entry", direction: "bull", dte: 120, spot: 333.65, framing: "$307 (-8%)", maxLoss: "assignment risk", aggressiveCase: "keep $12/sh credit", probability: "med-high" },
      { ticker: "GOOGL", company: "Alphabet", strategy: "Long Straddle", tag: "volatility", direction: "vol", dte: 45, spot: 354.46, framing: "$355 call + $355 put (ATM)", maxLoss: "$5,000", aggressiveCase: "~+218%", probability: "low" },
      { ticker: "NFLX", company: "Netflix", strategy: "Bear Put Spread", tag: "defined risk", direction: "bear", dte: 120, spot: 68.95, framing: "59 / 54", maxLoss: "$160", aggressiveCase: "~+213%", probability: "low-med" },
      { ticker: "XOM", company: "ExxonMobil", strategy: "Bull Call Spread", tag: "defined risk", direction: "bull", dte: 180, spot: 141.62, framing: "142 / 170", maxLoss: "$800", aggressiveCase: "~+250%", probability: "med" },
    ]},
  },
  {
    date: "2026-07-16", edition: 25,
    pipeline: { candidates: ["claude-fable-5", "gpt-5.6-terra", "grok-4.5"], judge: "local-llama-70b" },
    lead: {
      id: "e25-lead", topic: "chips", model: "claude", judgeScore: 8.8, sentiment: "bearish",
      headline: "TSMC posts a record quarter — and triggers a selloff",
      dek: "Record Q2 revenue with capex lifted to $60–64B; the Nasdaq falls 1.47% as AI-chip fatigue sets in.",
      body: ["TSMC's blowout quarter came with a 2026 capex raise that markets read as a warning about spending discipline across the AI build-out. The result: a second-day chip selloff that dragged the broader index down sharply."],
      whyItMatters: "Capex raises used to be bullish signals. The reaction function has flipped.",
      sources: [{ title: "Feed 2026-07-16", url: "https://daily-tech-brief-self.vercel.app/feeds/2026-07-16.html" }],
    },
    stories: [
      { id: "e25-s1", topic: "ai", model: "gpt", judgeScore: 8.2, sentiment: "neutral",
        headline: "Google model report roils the AI trade",
        dek: "A Bloomberg report added fuel to the de-rating.",
        body: ["A Bloomberg report on Google's model strategy compounded the risk-off tone in AI names through the session."],
        whyItMatters: "Narrative risk is now a bigger daily driver than earnings for the AI complex.",
        sources: [{ title: "Feed 2026-07-16", url: "https://daily-tech-brief-self.vercel.app/feeds/2026-07-16.html" }] },
    ],
    stocks: { updated: "post-close", picks: [
      { ticker: "NVDA", company: "NVIDIA", sector: "Semis", price: 209.55, scenarios: { "3m": 0, "6m": 5, "12m": 14, "18m": 20, "24m": 24 }, conviction: "high", sentiment: "neutral",
        reason: "High-conviction hold through the capex scare; demand signals intact.", sourceUrl: "https://daily-tech-brief-self.vercel.app/stocks/2026-07-16.html" },
      { ticker: "TSM", company: "Taiwan Semiconductor", sector: "Semis", price: 402.10, scenarios: { "3m": 1, "6m": 6, "12m": 15, "18m": 19, "24m": 23 }, conviction: "high", sentiment: "bullish",
        reason: "Record quarter; selloff read as positioning, not fundamentals.", sourceUrl: "https://daily-tech-brief-self.vercel.app/stocks/2026-07-16.html" },
      { ticker: "AMAT", company: "Applied Materials", sector: "Semis", price: null, scenarios: { "3m": 2, "6m": 6, "12m": 13, "18m": 16, "24m": 19 }, conviction: "high", sentiment: "bullish",
        reason: "Capex hikes across the fab complex flow straight to equipment makers.", sourceUrl: "https://daily-tech-brief-self.vercel.app/stocks/2026-07-16.html" },
    ]},
  },
  {
    date: "2026-07-14", edition: 24,
    pipeline: { candidates: ["claude-fable-5", "gpt-5.6-terra", "grok-4.5"], judge: "local-llama-70b" },
    lead: {
      id: "e24-lead", topic: "markets", model: "grok", judgeScore: 8.6, sentiment: "bearish",
      headline: "IBM's worst day on record as AI eats the IT budget",
      dek: "Down 25%+ on a Q2 warning; customers rotate spend to AI infrastructure while cooler CPI lifts the Nasdaq 1.08%.",
      body: ["IBM crashed more than 25% after warning that customers are redirecting budgets toward AI infrastructure. The same session, a cooler June CPI (~+3.5% YoY) lifted the tech-led Nasdaq, and the biggest US banks posted record Q2 profits led by JPMorgan."],
      whyItMatters: "The AI budget shift is no longer a thesis — it's showing up in legacy vendors' guidance.",
      sources: [{ title: "Feed 2026-07-14", url: "https://daily-tech-brief-self.vercel.app/feeds/2026-07-14.html" }],
    },
    stories: [],
  },
];

/* ---------- Storage helpers ---------- */
const K_CONFIG = "dtb-config";
const K_FEEDBACK = "dtb-feedback";
const K_EDITIONS = "dtb-imported-editions";

async function sGet(key, fallback) {
  try {
    const r = await window.storage.get(key);
    return r?.value ? JSON.parse(r.value) : fallback;
  } catch { return fallback; }
}
async function sSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); return true; }
  catch (e) { console.error("storage", e); return false; }
}

/* ---------- Small pieces ---------- */
const MODEL_META = {
  claude: { glyph: "glyph-claude", label: "CLAUDE" },
  gpt: { glyph: "glyph-gpt", label: "GPT" },
  grok: { glyph: "glyph-grok", label: "GROK" },
};

function Colophon({ story, feedback, onVote }) {
  const m = MODEL_META[story.model] || { glyph: "glyph-gpt", label: (story.model || "?").toUpperCase() };
  const vote = feedback[story.id]?.vote;
  return (
    <div className="dc-colophon">
      <span className="dc-model" title={`Winning model · judge score ${story.judgeScore ?? "—"}`}>
        <span className={`glyph ${m.glyph}`} /> {m.label}{story.judgeScore != null ? ` · ${story.judgeScore.toFixed(1)}` : ""}
      </span>
      {story.sentiment && <span className={`dc-sent ${story.sentiment}`}>{story.sentiment === "bullish" ? "▲" : story.sentiment === "bearish" ? "▼" : "►"} {story.sentiment}</span>}
      <span className="dc-src">
        {(story.sources || []).map((s, i) => (
          <span key={i}>{i > 0 && " · "}<a href={s.url} target="_blank" rel="noreferrer">{s.title || new URL(s.url).hostname}</a></span>
        ))}
      </span>
      <span className="dc-fb">
        <button className={vote === "keep" ? "on-keep" : ""} onClick={() => onVote(story, "keep")}
          aria-pressed={vote === "keep"}>More like this</button>
        <button className={vote === "spike" ? "on-spike" : ""} onClick={() => onVote(story, "spike")}
          aria-pressed={vote === "spike"}>Spike</button>
      </span>
    </div>
  );
}

function Story({ story, topicLabel, feedback, onVote, lead }) {
  const [open, setOpen] = useState(!!lead);
  const H = lead ? "h2" : "h3";
  return (
    <article className={lead ? "dc-lead" : "dc-story"}>
      {!lead && (
        <div className="dc-eyebrow"><span className="topic">{topicLabel}</span></div>
      )}
      <H>{story.headline}</H>
      {story.dek && <p className="dek">{story.dek}</p>}
      {open && (
        <>
          <div className="dc-body">{(story.body || []).map((p, i) => <p key={i}>{p}</p>)}</div>
          {story.whyItMatters && (
            <div className="dc-wim"><b>Why it matters</b>{story.whyItMatters}</div>
          )}
        </>
      )}
      {!lead && story.body?.length > 0 && (
        <button className="dc-more" onClick={() => setOpen(o => !o)}>
          {open ? "Fold" : "Read"}
        </button>
      )}
      <Colophon story={story} feedback={feedback} onVote={onVote} />
    </article>
  );
}

/* ---------- Views ---------- */
function EditionView({ edition, config, feedback, onVote }) {
  const topicLabel = useCallback(
    slug => config.topics.find(t => t.slug === slug)?.label || slug?.toUpperCase() || "GENERAL",
    [config.topics]
  );
  const enabledSlugs = new Set(config.topics.filter(t => t.enabled).map(t => t.slug));
  const grouped = useMemo(() => {
    const g = {};
    for (const s of edition.stories || []) {
      if (s.topic && enabledSlugs.size && !enabledSlugs.has(s.topic)) continue;
      (g[s.topic || "general"] ||= []).push(s);
    }
    return g;
  }, [edition, config.topics]);

  const d = new Date(edition.date + "T12:00:00");
  const dateStr = d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div>
      <div className="dc-edhead">
        <span><b>{dateStr}</b></span>
        <span>No. {edition.edition} · judged by {edition.pipeline?.judge || "—"}</span>
      </div>
      {edition.lead && (
        <Story lead story={edition.lead} topicLabel={topicLabel(edition.lead.topic)}
          feedback={feedback} onVote={onVote} />
      )}
      {Object.entries(grouped).map(([slug, stories]) => (
        <section key={slug}>
          <div className="dc-section-h"><span>{topicLabel(slug)}</span></div>
          <div className="dc-grid">
            {stories.map(s => (
              <Story key={s.id} story={s} topicLabel={topicLabel(slug)}
                feedback={feedback} onVote={onVote} />
            ))}
          </div>
        </section>
      ))}
      {(!edition.stories || edition.stories.length === 0) && (
        <p className="dc-empty">A thin news day — only the lead made the cut.</p>
      )}
    </div>
  );
}

function ArchiveView({ editions, onOpen }) {
  return (
    <ul className="dc-arch">
      {editions.map(ed => (
        <li key={ed.date}>
          <button onClick={() => onOpen(ed.date)}>
            <span className="d">{new Date(ed.date + "T12:00:00").toLocaleDateString("en-US",
              { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · No. {ed.edition}</span>
            <h4>{ed.lead?.headline || "Untitled edition"}</h4>
            <span className="m">
              {(ed.stories?.length || 0) + (ed.lead ? 1 : 0)} stories · {ed.pipeline?.candidates?.length || 0} models competed
              {ed.stocks ? ` · ${ed.stocks.picks.length} stock picks` : ""}{ed.options ? ` · ${ed.options.ideas.length} option ideas` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DeskView({ config, setConfig, feedback, editions, onImport }) {
  const [topicName, setTopicName] = useState("");
  const [topicWeight, setTopicWeight] = useState("normal");
  const [srcDomain, setSrcDomain] = useState("");
  const [srcTrust, setSrcTrust] = useState("allowed");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = next => setConfig(next);

  const addTopic = () => {
    const label = topicName.trim();
    if (!label) return;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (config.topics.some(t => t.slug === slug)) return;
    save({ ...config, topics: [...config.topics, { slug, label, weight: topicWeight, enabled: true }] });
    setTopicName("");
  };
  const addSource = () => {
    const domain = srcDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain || config.sources.some(s => s.domain === domain)) return;
    save({ ...config, sources: [...config.sources, { domain, trust: srcTrust }] });
    setSrcDomain("");
  };

  const exportPayload = useMemo(() => JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    briefName: config.briefName,
    topics: config.topics,
    sources: config.sources,
    feedback: Object.entries(feedback).map(([storyId, f]) => ({ storyId, ...f })),
  }, null, 2), [config, feedback]);

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const eds = Array.isArray(parsed) ? parsed : [parsed];
      for (const e of eds) {
        if (!e.date || (!e.lead && !e.stories)) throw new Error("edition needs at least `date` and `lead` or `stories`");
      }
      onImport(eds);
      setImportMsg({ ok: true, text: `Imported ${eds.length} edition${eds.length > 1 ? "s" : ""}. Check the Archive.` });
      setImportText("");
    } catch (e) {
      setImportMsg({ ok: false, text: `Rejected: ${e.message}` });
    }
  };

  const copyExport = async () => {
    try { await navigator.clipboard.writeText(exportPayload); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setShowExport(true); }
  };

  const weights = ["high", "normal", "low"];
  const trusts = ["preferred", "allowed", "blocked"];

  return (
    <div className="dc-desk">
      <h3>Masthead</h3>
      <p className="hint">Name the paper. It's yours, after all.</p>
      <div className="dc-add">
        <input value={config.briefName}
          onChange={e => save({ ...config, briefName: e.target.value })}
          aria-label="Brief name" />
      </div>

      <h3>Topics</h3>
      <p className="hint">Weight tells the pipeline how much column space each desk earns. Toggling off hides it here and exports as disabled.</p>
      {config.topics.map(t => (
        <div className="dc-row" key={t.slug}>
          <span className="name">{t.label}<small>{t.slug}</small></span>
          {weights.map(w => (
            <button key={w} className={`dc-pill ${t.weight === w ? "on" : ""}`}
              onClick={() => save({ ...config, topics: config.topics.map(x => x.slug === t.slug ? { ...x, weight: w } : x) })}>{w}</button>
          ))}
          <button className={`dc-pill ${t.enabled ? "good on" : ""}`}
            onClick={() => save({ ...config, topics: config.topics.map(x => x.slug === t.slug ? { ...x, enabled: !x.enabled } : x) })}>
            {t.enabled ? "on" : "off"}
          </button>
          <button className="dc-x" aria-label={`Remove ${t.label}`}
            onClick={() => save({ ...config, topics: config.topics.filter(x => x.slug !== t.slug) })}>✕</button>
        </div>
      ))}
      <div className="dc-add">
        <input placeholder="New topic, e.g. Robotics & Humanoids" value={topicName}
          onChange={e => setTopicName(e.target.value)} onKeyDown={e => e.key === "Enter" && addTopic()} />
        <select value={topicWeight} onChange={e => setTopicWeight(e.target.value)}>
          {weights.map(w => <option key={w}>{w}</option>)}
        </select>
        <button className="dc-btn" onClick={addTopic}>Add topic</button>
      </div>

      <h3>Sources</h3>
      <p className="hint">Preferred sources get cited first; blocked ones never make print.</p>
      {config.sources.map(s => (
        <div className="dc-row" key={s.domain}>
          <span className="name" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{s.domain}</span>
          {trusts.map(tr => (
            <button key={tr}
              className={`dc-pill ${tr === "blocked" ? "warn" : tr === "preferred" ? "good" : ""} ${s.trust === tr ? "on" : ""}`}
              onClick={() => save({ ...config, sources: config.sources.map(x => x.domain === s.domain ? { ...x, trust: tr } : x) })}>{tr}</button>
          ))}
          <button className="dc-x" aria-label={`Remove ${s.domain}`}
            onClick={() => save({ ...config, sources: config.sources.filter(x => x.domain !== s.domain) })}>✕</button>
        </div>
      ))}
      <div className="dc-add">
        <input placeholder="domain or RSS host, e.g. arstechnica.com" value={srcDomain}
          onChange={e => setSrcDomain(e.target.value)} onKeyDown={e => e.key === "Enter" && addSource()} />
        <select value={srcTrust} onChange={e => setSrcTrust(e.target.value)}>
          {trusts.map(t => <option key={t}>{t}</option>)}
        </select>
        <button className="dc-btn" onClick={addSource}>Add source</button>
      </div>

      <h3>Pipeline exchange</h3>
      <p className="hint">Export config + feedback for the pipeline to consume; paste edition JSON from S3 to preview it here. {Object.keys(feedback).length} feedback marks recorded.</p>
      <div className="dc-add">
        <button className="dc-btn" onClick={copyExport}>{copied ? "Copied ✓" : "Copy config + feedback JSON"}</button>
        <button className="dc-btn ghost" onClick={() => setShowExport(s => !s)}>{showExport ? "Hide" : "View"} payload</button>
      </div>
      {showExport && <pre className="dc-export">{exportPayload}</pre>}
      <div className="dc-import">
        <textarea placeholder='Paste edition JSON (single object or array). Minimum: {"date":"2026-07-18","lead":{...},"stories":[...]}'
          value={importText} onChange={e => setImportText(e.target.value)} />
        <div className="dc-add">
          <button className="dc-btn" onClick={doImport} disabled={!importText.trim()}>Import edition</button>
        </div>
        {importMsg && <p className={`dc-note ${importMsg.ok ? "ok" : "err"}`}>{importMsg.text}</p>}
      </div>
    </div>
  );
}

/* ---------- Market pages ---------- */
const Pct = ({ v }) => (
  <span className={`num ${v > 0 ? "pos" : v < 0 ? "neg" : ""}`}>{v > 0 ? "+" : ""}{v}%</span>
);
const SENT_ICON = { bullish: "▲", bearish: "▼", neutral: "►" };

function SnapshotList({ editions, currentDate, kind, onOpen }) {
  const past = editions.filter(e => e.date !== currentDate && e[kind]);
  if (!past.length) return null;
  return (
    <div className="dc-snaps">
      <div className="dc-section-h"><span>Past {kind === "stocks" ? "snapshots" : "sheets"}</span></div>
      <ul className="dc-arch">
        {past.map(e => {
          const items = kind === "stocks" ? e.stocks.picks : e.options.ideas;
          const highs = kind === "stocks" ? items.filter(p => p.conviction === "high").map(p => p.ticker) : [];
          const bulls = items.filter(i => (i.sentiment || i.direction) === "bullish" || i.direction === "bull").length;
          return (
            <li key={e.date}>
              <button onClick={() => onOpen(e.date)}>
                <span className="d">{new Date(e.date + "T12:00:00").toLocaleDateString("en-US",
                  { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                <h4 style={{ fontSize: 17 }}>
                  {items.length} {kind === "stocks" ? "picks tracked" : "directional ideas"} · lean {bulls >= items.length / 2 ? "bullish" : "bearish"}
                  {highs.length ? ` · ${highs.join(", ")} high-conviction` : ""}
                </h4>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StocksView({ edition, editions, onOpenDate }) {
  const [open, setOpen] = useState(null);
  const picks = edition?.stocks?.picks;
  if (!picks) return <p className="dc-empty">No stocks snapshot in this edition. The pipeline owes you one.</p>;
  const horizons = ["3m", "6m", "12m", "18m", "24m"];
  return (
    <div>
      <div className="dc-mkt-head">
        <h2>Picks & Scenario Ranges</h2>
        <span className="tag">{edition.stocks.updated || "post-close"}</span>
      </div>
      <p className="hint" style={{ fontStyle: "italic", color: "var(--ink-soft)", marginBottom: 10 }}>
        Model-projected midpoints. Tap a row for the reasoning and source.
      </p>
      <div className="dc-tablewrap">
        <table className="dc-tab">
          <thead><tr>
            <th>Ticker</th><th>Sector</th><th>Price</th>
            {horizons.map(h => <th key={h}>{h.toUpperCase()}</th>)}
            <th>Conv.</th><th>Sent.</th>
          </tr></thead>
          <tbody>
            {picks.map(p => (
              <>
                <tr key={p.ticker} className="dc-exp-toggle" onClick={() => setOpen(open === p.ticker ? null : p.ticker)}>
                  <td className="tick">{p.ticker}<small>{p.company}</small></td>
                  <td>{p.sector}</td>
                  <td className="num">{p.price != null ? `$${p.price.toFixed(2)}` : "—"}</td>
                  {horizons.map(h => <td key={h}><Pct v={p.scenarios?.[h] ?? 0} /></td>)}
                  <td><span className={`dc-conv ${p.conviction}`}>{p.conviction}</span></td>
                  <td className={`dc-sent ${p.sentiment}`}>{SENT_ICON[p.sentiment] || ""} {p.sentiment}</td>
                </tr>
                {open === p.ticker && (
                  <tr className="dc-exp" key={p.ticker + "-x"}>
                    <td colSpan={horizons.length + 5}>
                      <span className="why">{p.reason}</span>{" "}
                      {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer">source ↗</a>}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dc-mkt-note">
        Speculative, AI-generated scenarios under stated assumptions — not forecasts, price targets, or guarantees. Not investment advice.
      </p>
      <SnapshotList editions={editions} currentDate={edition.date} kind="stocks" onOpen={onOpenDate} />
    </div>
  );
}

function OptionsView({ edition, editions, onOpenDate }) {
  const [open, setOpen] = useState(null);
  const ideas = edition?.options?.ideas;
  if (!ideas) return <p className="dc-empty">No options sheet in this edition.</p>;
  const dirIcon = { bull: "▲", bear: "▼", vol: "◆" };
  const dirClass = { bull: "bullish", bear: "bearish", vol: "neutral" };
  return (
    <div>
      <div className="dc-mkt-head">
        <h2>Directional Ideas</h2>
        <span className="tag">{edition.options.updated || "post-close"}</span>
      </div>
      <div className="dc-tablewrap">
        <table className="dc-tab">
          <thead><tr>
            <th>#</th><th>Ticker</th><th>Strategy</th><th>Dir</th><th>DTE</th>
            <th>Spot</th><th>Strike (framing)</th><th>Max loss</th><th>Aggressive case</th><th>Prob</th>
          </tr></thead>
          <tbody>
            {ideas.map((o, i) => (
              <>
                <tr key={i} className="dc-exp-toggle" onClick={() => setOpen(open === i ? null : i)}>
                  <td className="num">{i + 1}</td>
                  <td className="tick">{o.ticker}<small>{o.company}</small></td>
                  <td>{o.strategy}<div style={{ fontFamily: "var(--label)", fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-soft)" }}>{o.tag}</div></td>
                  <td className={`dc-sent ${dirClass[o.direction] || "neutral"}`}>{dirIcon[o.direction] || ""} {o.direction}</td>
                  <td className="num">~{o.dte}</td>
                  <td className="num">{o.spot != null ? `$${o.spot.toFixed(2)}` : "—"}</td>
                  <td className="num">{o.framing}</td>
                  <td className="num">{o.maxLoss}</td>
                  <td className="num pos">{o.aggressiveCase}</td>
                  <td className="num">{o.probability}</td>
                </tr>
                {open === i && (
                  <tr className="dc-exp" key={i + "-x"}>
                    <td colSpan={10}>
                      <span className="why">
                        {o.direction === "vol" ? "Profits from a large move in either direction; loses to time decay if the underlying stays put."
                          : o.direction === "bear" ? "Defined-risk bet the underlying falls toward the lower strike by expiry."
                          : "Thesis-driven upside exposure keyed to the stocks pipeline's 12m midpoint."} Max loss for long options is 100% of premium. Verify live premiums before acting.
                      </span>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dc-mkt-note">
        Aggressive-case multiples are hypothetical, model-derived best cases — low probability, not expected returns. Premiums and strikes are approximations; verify live. Not investment advice.
      </p>
      <SnapshotList editions={editions} currentDate={edition.date} kind="options" onOpen={onOpenDate} />
    </div>
  );
}

/* ---------- App ---------- */
export default function DailyCompile() {
  const [config, setConfigState] = useState(DEFAULT_CONFIG);
  const [feedback, setFeedback] = useState({});
  const [imported, setImported] = useState([]);
  const [view, setView] = useState("today");
  const [openDate, setOpenDate] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, f, e] = await Promise.all([
        sGet(K_CONFIG, DEFAULT_CONFIG), sGet(K_FEEDBACK, {}), sGet(K_EDITIONS, []),
      ]);
      setConfigState({ ...DEFAULT_CONFIG, ...c });
      setFeedback(f); setImported(e); setReady(true);
    })();
  }, []);

  const setConfig = next => { setConfigState(next); sSet(K_CONFIG, next); };

  const editions = useMemo(() => {
    const byDate = {};
    for (const e of [...MOCK_EDITIONS, ...imported]) byDate[e.date] = e; // imports override mocks
    return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
  }, [imported]);

  const current = editions.find(e => e.date === openDate) || editions[0];

  const onVote = (story, vote) => {
    const next = { ...feedback };
    if (next[story.id]?.vote === vote) delete next[story.id];
    else next[story.id] = { vote, topic: story.topic, model: story.model, date: current?.date, at: new Date().toISOString() };
    setFeedback(next); sSet(K_FEEDBACK, next);
  };

  const onImport = eds => {
    const next = [...imported.filter(e => !eds.some(n => n.date === e.date)),
      ...eds.map((e, i) => ({ edition: e.edition ?? 0, pipeline: e.pipeline ?? {}, stories: e.stories ?? [], ...e }))];
    setImported(next); sSet(K_EDITIONS, next);
    setOpenDate(eds[eds.length - 1].date); setView("today");
  };

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="dc-root">
      <style>{CSS}</style>
      <div className="dc-shell">
        <header className="dc-mast">
          <div className="dc-mast-top">
            <span>VOL. I · {editions.length} EDITIONS</span>
            <span>{today}</span>
          </div>
          <h1>{config.briefName || "The Daily Compile"}</h1>
          <p className="dc-mast-sub">Three models write · one judge decides · you get the paper</p>
        </header>
        <nav className="dc-nav" aria-label="Sections">
          {[["today", "Today's Edition"], ["stocks", "Stocks"], ["options", "Options"], ["archive", "Archive"], ["desk", "The Desk"]].map(([k, label]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{label}</button>
          ))}
        </nav>

        {!ready ? <p className="dc-empty">Setting the type…</p> : (
          <>
            {view === "today" && current && (
              <EditionView edition={current} config={config} feedback={feedback} onVote={onVote} />
            )}
            {view === "stocks" && current && (
              <StocksView edition={current} editions={editions}
                onOpenDate={d => setOpenDate(d)} />
            )}
            {view === "options" && current && (
              <OptionsView edition={current} editions={editions}
                onOpenDate={d => setOpenDate(d)} />
            )}
            {view === "archive" && (
              <ArchiveView editions={editions} onOpen={d => { setOpenDate(d); setView("today"); }} />
            )}
            {view === "desk" && (
              <DeskView config={config} setConfig={setConfig} feedback={feedback}
                editions={editions} onImport={onImport} />
            )}
          </>
        )}

        <footer className="dc-foot">
          {editions.length} feed briefs · {editions.filter(e => e.stocks).length} stock snapshots · {editions.filter(e => e.options).length} options sheets · auto-generated · multi-model pipeline · AI research, not investment advice
        </footer>
      </div>
    </div>
  );
}
