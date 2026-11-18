'use client';

import React from 'react';

/** Tiny, dependency-free Markdown renderer for AI replies.
 *  It renders React elements (never dangerouslySetInnerHTML), so model output
 *  cannot inject HTML or scripts. Supports headings, paragraphs, bullet lists,
 *  blockquotes, fenced code, tables and inline **bold** / `code`. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((p, i) => {
    const key = `${keyBase}-i${i}`;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={key} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={key} className="px-1 py-0.5 rounded bg-muted/60 text-[11px] font-mono">{p.slice(1, -1)}</code>;
    return <React.Fragment key={key}>{p}</React.Fragment>;
  });
}

export default function Markdown({ text }: { text: string }) {
  const lines = String(text || '').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let seq = 0;
  const key = () => `md-${seq++}`;

  const flushList = () => {
    if (!list.length) return;
    const items = list; list = [];
    blocks.push(
      <ul key={key()} className="list-disc pl-5 space-y-1">
        {items.map((it, i) => <li key={i}>{inline(it, `li${i}`)}</li>)}
      </ul>,
    );
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith('```')) {
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++; }
      i++;
      blocks.push(
        <pre key={key()} className="p-3 rounded-lg bg-muted/40 border border-border/60 overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap">
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Table: header row followed by an alignment row
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
      flushList();
      const cells = (row: string) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      blocks.push(
        <div key={key()} className="table-wrap my-1">
          <table className="table table-hover">
            <thead><tr>{head.map((h, idx) => <th key={idx}>{inline(h, `th${idx}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `td${ri}-${ci}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^####\s/.test(line)) { flushList(); blocks.push(<h4 key={key()} className="font-bold text-sm pt-1">{inline(line.slice(5), key())}</h4>); i++; continue; }
    if (/^###\s/.test(line)) { flushList(); blocks.push(<h3 key={key()} className="font-bold text-base pt-1">{inline(line.slice(4), key())}</h3>); i++; continue; }
    if (/^##\s/.test(line)) { flushList(); blocks.push(<h2 key={key()} className="font-bold text-lg pt-1">{inline(line.slice(3), key())}</h2>); i++; continue; }
    if (/^>\s?/.test(line)) { flushList(); blocks.push(<blockquote key={key()} className="border-l-2 border-primary/60 pl-3 text-muted-foreground italic">{inline(line.replace(/^>\s?/, ''), key())}</blockquote>); i++; continue; }
    if (/^\s*[-*]\s/.test(line)) { list.push(line.replace(/^\s*[-*]\s/, '')); i++; continue; }
    if (!line.trim()) { flushList(); i++; continue; }
    flushList();
    blocks.push(<p key={key()}>{inline(line, key())}</p>);
    i++;
  }
  flushList();

  return <div className="space-y-2 text-xs sm:text-sm leading-relaxed break-words">{blocks}</div>;
}
