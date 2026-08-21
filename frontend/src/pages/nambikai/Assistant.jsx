import { ScreenHeader } from '../../components/AppLayout.jsx';
import ChatColumn from '../../components/nambikai/ChatColumn.jsx';
import ConsentGate from '../../components/nambikai/ConsentGate.jsx';
import { Card, Spinner } from '../../components/primitives.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

export default function Assistant() {
  const meta = useAsync(() => api.nambikai.assistantSuggestions(), []);
  // Probe the gate up front so the wall appears instead of a chat that refuses
  // every message.
  const probe = useAsync(() => api.nambikai.score(), []);
  const blocked = probe.error?.code === 'CONSENT_REQUIRED';

  if (probe.loading) {
    return (
      <>
        <ScreenHeader title="Nambikai assistant" tone="brand" />
        <div className="flex justify-center py-20">
          <Spinner size={26} className="text-navy" />
        </div>
      </>
    );
  }

  if (blocked) {
    return (
      <>
        <ScreenHeader title="Nambikai assistant" tone="brand" />
        <div className="px-3 pt-3">
          <ConsentGate error={probe.error} title="The assistant needs permission first" />
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Nambikai assistant"
        subtitle="Answers about your own money"
        tone="brand"
      />
      <ChatColumn
        suggestions={meta.data?.suggestions ?? []}
        greeting="Ask me anything about your Nambikai score, your savings circles, or what a lender would see. I only work from your own signals — I can't see your individual transactions."
        onAsk={({ question, history }) => api.nambikai.ask({ question, history })}
      />
    </>
  );
}
