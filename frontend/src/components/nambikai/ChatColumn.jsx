import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Button, Spinner, cx } from '../primitives.jsx';

/**
 * The chat surface.
 *
 * Two things are always visible and are not decoration:
 *   - a persistent strip saying the assistant only sees Nambikai signals
 *   - a per-answer label saying whether a model or a template wrote it
 *
 * A financial assistant that will not say where its words came from is asking to
 * be trusted on nothing.
 */
function Bubble({ turn }) {
  const mine = turn.role === 'user';
  return (
    <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed',
          mine ? 'bg-navy text-white' : 'bg-white text-ink shadow-card',
        )}
      >
        {turn.content}
        {!mine && turn.source && (
          <span className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-faint">
            <Icon name={turn.source === 'LLM' ? 'sparkle' : 'document'} size={12} />
            {turn.source === 'LLM' ? 'Written by Claude from your signals' : 'Written from your signals'}
            {turn.refused && ' · outside what I can answer'}
          </span>
        )}
        {!mine && turn.groundedIn?.length > 0 && <Sources keys={turn.groundedIn} />}
      </div>
    </div>
  );
}

function Sources({ keys }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline"
      >
        <Icon name="chevronDown" size={11} className={cx('transition-transform', open && 'rotate-180')} />
        Sources
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {keys.map((k) => (
            <li key={k} className="text-[11px] text-ink-faint">
              · {k.replace(/_/g, ' ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ChatColumn({ suggestions = [], onAsk, greeting }) {
  const [turns, setTurns] = useState(greeting ? [{ role: 'assistant', content: greeting }] : []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  async function send(question) {
    const text = question.trim();
    if (!text || busy) return;
    setDraft('');
    const history = turns.filter((t) => t.content).map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const res = await onAsk({ question: text, history });
      setTurns((t) => [
        ...t,
        { role: 'assistant', content: res.answer, source: res.source, refused: res.refused, groundedIn: res.groundedIn },
      ]);
    } catch (err) {
      setTurns((t) => [...t, { role: 'assistant', content: err.message, source: 'TEMPLATE' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col">
      <div className="flex-1 space-y-3 px-3 pb-3 pt-3">
        {turns.map((turn, i) => (
          <Bubble key={i} turn={turn} />
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-white px-3.5 py-3 shadow-card">
              <Spinner size={16} className="text-navy" />
            </div>
          </div>
        )}
        {turns.length <= 1 && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-sky hover:bg-sky-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 border-t border-line bg-white/95 px-3 pb-3 pt-2.5 backdrop-blur">
        <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
          <Icon name="shield" size={12} />
          Grounded in your Nambikai signals only — never your transactions
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about your money…"
            className="h-11 flex-1 rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/25"
          />
          <Button type="submit" size="md" disabled={!draft.trim() || busy}>
            <Icon name="send" size={17} />
          </Button>
        </form>
      </div>
    </div>
  );
}
