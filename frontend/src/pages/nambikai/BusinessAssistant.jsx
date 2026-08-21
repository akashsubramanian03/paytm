import { useParams } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import ChatColumn from '../../components/nambikai/ChatColumn.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

export default function BusinessAssistant() {
  const { id } = useParams();
  const meta = useAsync(() => api.nambikai.businessSuggestions(id), [id]);
  const business = useAsync(() => api.nambikai.business(id), [id]);

  return (
    <>
      <ScreenHeader
        title={business.data?.business?.name ?? 'Business assistant'}
        subtitle="Answers from your business records"
        tone="brand"
      />
      <ChatColumn
        suggestions={meta.data?.suggestions ?? []}
        greeting="Ask about your revenue, your receivables, your GST filings, or what a lender would see about this business."
        onAsk={({ question, history }) => api.nambikai.businessAsk(id, { question, history })}
      />
    </>
  );
}
