/**
 * KanbanPage — K1: the read-only wall over the maintenance journal (kanban-wall-plan.md).
 *
 * Reads ONE feed (/api/board — K0's parser serialised; no second board-reading path).
 * Read-only, zero state, no writes (the wall has no hands until K3). Every string
 * renders as React text — no dangerouslySetInnerHTML anywhere (Tenshi's K1 P0 line:
 * untrusted journal prose must never reach a raw-HTML sink).
 *
 * Render notes carried from the audits:
 *  - NONCONFORMING is mostly history: 13 pre-vocabulary closures + drift (Casey's
 *    classification) — the lane is labelled so it never reads as "21 problems".
 *  - OPEN carries an honesty caveat until Tenshi's staleness triage lands (MNT-001
 *    demonstrated closed-in-metal / open-on-board); her STATUS UPDATE verdicts move
 *    cards automatically through the parser's chain supersession.
 *  - PARKED cards surface their resume trigger (the trigger says which job you can
 *    take tonight — the date only sorts).
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './KanbanPage.css';

interface BoardLink { kind: string; target: string }
interface BoardCard {
    id: string; num: number; suffix: string; title: string; date: string | null;
    effectiveState: string; statusRaw: string | null; lastStatusRaw: string | null;
    updates: number; severity: string | null; owner: string | null;
    resumeWhen: string | null; line: number; links: BoardLink[]; blockedBy: string[];
}
interface BoardFeed {
    success: boolean; generatedAt: string; source: string;
    reconciliation: {
        rawHeaderCount: number; parsedEntryCount: number; updateHeaderCount: number;
        unparseableCount: number; reconciles: boolean; laneTotals: Record<string, number>;
    };
    entries: BoardCard[];
    unparseable: { line: number; headerText: string }[];
    backlinks: Record<string, string[]>;
    hearth: {
        counters: { ts: string; kind: string; slug?: string; surface?: string; requested?: string; observed?: string; verdict?: string }[];
        // K1-M1 (Jim's audit): all agents' session pools, slug-keyed — never one hardcoded slug (DEC-081).
        sessionPools: Record<string, { stems?: { stem_id: string; model: string; state: string; warm_at: string }[] } | null>;
        tickPlans: { file: string; headings: string[] }[];
    };
}

/** Lane order per Jim's K1 spec: REOPENED loud, live lanes, computed lanes, archive drawer. */
const LIVE_LANES = ['REOPENED', 'OPEN', 'IN-PROGRESS', 'PARKED', 'BLOCKED', 'Unclassified', 'NONCONFORMING'];
const ARCHIVE_LANES = ['CLOSED', "WON'T-FIX", 'BENIGN-BY-DESIGN', 'DUPLICATE'];

const LANE_NOTES: Record<string, string> = {
    OPEN: 'honesty caveat: staleness triage in progress — some OPEN cards are closed in the metal (e.g. MNT-001); verdicts move cards automatically',
    NONCONFORMING: 'mostly history: pre-vocabulary closures + drift (13 closed-in-fact per the audit) — lint food, not 21 problems',
    Unclassified: 'no Status line has ever been written — the nobody-ever-assessed count, exact by construction',
    PARKED: 'the resume trigger says which job you can take tonight — the date only sorts',
};

function ageDays(date: string | null): string {
    if (!date) return '';
    const d = Math.floor((Date.now() - new Date(date + 'T00:00:00').getTime()) / 86_400_000);
    return d <= 0 ? 'today' : `${d}d`;
}

function Card({ c, backlinks }: { c: BoardCard; backlinks: string[] }) {
    const [open, setOpen] = useState(false);
    return (
        <div className={`kb-card sev-${(c.severity ?? '').split(/[\s(]/)[0].toLowerCase()}`}>
            <div className="kb-card-head" onClick={() => setOpen(!open)}>
                <span className="kb-id">{c.id}</span>
                <span className="kb-age">{ageDays(c.date)}</span>
                {c.updates > 0 && <span className="kb-updates" title={`${c.updates} status update(s) in the chain`}>⛓{c.updates}</span>}
            </div>
            <div className="kb-title">{c.title}</div>
            <div className="kb-meta">
                {c.severity && <span className="kb-chip kb-sev">{c.severity.split('(')[0].trim()}</span>}
                {c.owner && <span className="kb-chip kb-owner">{c.owner.length > 24 ? c.owner.slice(0, 24) + '…' : c.owner}</span>}
            </div>
            {c.resumeWhen && <div className="kb-resume">⏰ {c.resumeWhen}</div>}
            {c.blockedBy.length > 0 && <div className="kb-blocked">⛔ blocked by {c.blockedBy.join(', ')}</div>}
            {open && (
                <div className="kb-detail">
                    {c.lastStatusRaw && <div className="kb-raw">status: {c.lastStatusRaw.slice(0, 160)}</div>}
                    <div className="kb-links">
                        {c.links.map((l, i) => (
                            <span key={i} className={`kb-chip kb-link kb-${l.kind}`}
                                title="click to copy"
                                onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(l.target); }}>
                                {l.kind === 'thread' ? '🧵' : ''}{l.target}
                            </span>
                        ))}
                    </div>
                    {backlinks.length > 0 && <div className="kb-backlinks">← pointed at by: {backlinks.join(', ')}</div>}
                    <div className="kb-provenance">journal:{c.line} — the entry is the record; this card is a pointer</div>
                </div>
            )}
        </div>
    );
}

export default function KanbanPage() {
    const [feed, setFeed] = useState<BoardFeed | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [showArchive, setShowArchive] = useState(false);

    useEffect(() => {
        let live = true;
        const load = (): void => {
            apiFetch('/api/board')
                .then(r => r.json())
                .then(d => { if (live) { d.success ? setFeed(d) : setErr(d.error ?? 'feed error'); } })
                .catch(e => { if (live) setErr(String(e)); });
        };
        load();
        const t = setInterval(load, 60_000); // file-is-source; one poller, page renders
        return () => { live = false; clearInterval(t); };
    }, []);

    if (err) return <div className="kb-page"><div className="kb-error">board feed error: {err}</div></div>;
    if (!feed) return <div className="kb-page"><div className="kb-loading">reading the journal…</div></div>;

    const r = feed.reconciliation;
    const byLane = (lane: string): BoardCard[] =>
        feed.entries.filter(e => e.effectiveState === lane)
            .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.num - a.num);
    const archiveCount = ARCHIVE_LANES.reduce((n, l) => n + (r.laneTotals[l] ?? 0), 0);

    return (
        <div className="kb-page">
            <div className="kb-header">
                <h1>🗂 The Wall</h1>
                <div className={`kb-reconcile ${r.reconciles ? 'ok' : 'bad'}`}>
                    {r.reconciles
                        ? `reconciles: ${r.rawHeaderCount} headers = ${r.parsedEntryCount} cards + ${r.updateHeaderCount} updates + ${r.unparseableCount} unparseable`
                        : '⚠ RECONCILIATION FAILED — the wall may be lying; trust the journal, not this render'}
                    <span className="kb-stamp"> · {feed.source} · {new Date(feed.generatedAt).toLocaleTimeString()}</span>
                </div>
            </div>

            <div className="kb-lanes">
                {LIVE_LANES.map(lane => {
                    const cards = byLane(lane);
                    if (cards.length === 0 && !(lane in r.laneTotals)) return null;
                    return (
                        <div key={lane} className={`kb-lane lane-${lane.toLowerCase().replace(/[^a-z]/g, '')}`}>
                            <div className="kb-lane-head">
                                <span className="kb-lane-name">{lane}</span>
                                <span className="kb-lane-count">{cards.length}</span>
                            </div>
                            {LANE_NOTES[lane] && <div className="kb-lane-note">{LANE_NOTES[lane]}</div>}
                            <div className="kb-lane-cards">
                                {cards.map(c => <Card key={c.id} c={c} backlinks={feed.backlinks[c.id] ?? []} />)}
                            </div>
                        </div>
                    );
                })}
                {feed.unparseable.length > 0 && (
                    <div className="kb-lane lane-unparseable">
                        <div className="kb-lane-head"><span className="kb-lane-name">UNPARSEABLE</span><span className="kb-lane-count">{feed.unparseable.length}</span></div>
                        <div className="kb-lane-note">headers the parser could not read — visible debt, never hidden</div>
                        {feed.unparseable.map((u, i) => (
                            <div key={i} className="kb-card"><div className="kb-title">{u.headerText}</div><div className="kb-provenance">journal:{u.line}</div></div>
                        ))}
                    </div>
                )}
            </div>

            <div className="kb-archive">
                <button className="kb-archive-toggle" onClick={() => setShowArchive(!showArchive)}>
                    {showArchive ? '▾' : '▸'} archive drawer — {archiveCount} closed cards ({ARCHIVE_LANES.filter(l => r.laneTotals[l]).map(l => `${l} ${r.laneTotals[l]}`).join(' · ')})
                </button>
                {showArchive && (
                    <div className="kb-lanes">
                        {ARCHIVE_LANES.map(lane => {
                            const cards = byLane(lane);
                            if (!cards.length) return null;
                            return (
                                <div key={lane} className="kb-lane lane-archive">
                                    <div className="kb-lane-head"><span className="kb-lane-name">{lane}</span><span className="kb-lane-count">{cards.length}</span></div>
                                    <div className="kb-lane-cards">
                                        {cards.map(c => <Card key={c.id} c={c} backlinks={feed.backlinks[c.id] ?? []} />)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="kb-hearth">
                <h2>🔥 The hearth</h2>
                <div className="kb-hearth-grid">
                    <div className="kb-hearth-col">
                        <h3>Session pools</h3>
                        {Object.entries(feed.hearth.sessionPools ?? {}).some(([, p]) => p?.stems?.length)
                            ? Object.entries(feed.hearth.sessionPools ?? {}).flatMap(([slug, p]) =>
                                (p?.stems ?? []).map(s => (
                                    <div key={`${slug}-${s.stem_id}`} className="kb-card">
                                        <div className="kb-title"><span className="kb-chip">{slug}</span> {s.stem_id}</div>
                                        <div className="kb-meta"><span className="kb-chip">{s.model}</span><span className="kb-chip">{s.state}</span><span className="kb-age">warm {new Date(s.warm_at).toLocaleTimeString()}</span></div>
                                    </div>)))
                            : <div className="kb-empty">no warm stems (cold fallback active)</div>}
                    </div>
                    <div className="kb-hearth-col">
                        <h3>Recent fires</h3>
                        {feed.hearth.counters.slice(0, 12).map((c, i) => (
                            <div key={i} className="kb-fire">
                                <span className="kb-fire-ts">{new Date(c.ts).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
                                <span className={`kb-chip kb-${c.kind}`}>{c.kind}</span>
                                <span className="kb-fire-who">{c.slug}/{c.surface}{c.requested ? ` → ${c.requested} (${c.observed})` : ''}{c.verdict ? ` ${c.verdict}` : ''}</span>
                            </div>
                        ))}
                    </div>
                    <div className="kb-hearth-col">
                        <h3>Night watches</h3>
                        {feed.hearth.tickPlans.map(p => (
                            <div key={p.file} className="kb-card">
                                <div className="kb-title">{p.file.replace('fi-top-ten-', 'watch of ').replace('.md', '')}</div>
                                {p.headings.slice(0, 10).map((h, i) => <div key={i} className="kb-plan-line">{h}</div>)}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
