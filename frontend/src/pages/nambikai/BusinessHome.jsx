import { Link } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import { Card, EmptyState, ListRow, MockBadge, Spinner } from '../../components/primitives.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

export default function BusinessHome() {
  const { data, error, loading } = useAsync(() => api.nambikai.businesses(), []);
  const businesses = data?.businesses ?? [];

  return (
    <>
      <ScreenHeader title="Your businesses" subtitle="Assessed on their own records" tone="brand" />
      <div className="space-y-3 px-3 pt-3">
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {!loading && businesses.length === 0 && (
          <Card>
            <EmptyState
              icon="store"
              title="No business registered"
              description="A business is scored on its own records — invoices, receivables and GST filings — separately from your personal wallet."
            />
          </Card>
        )}

        {businesses.map((b) => (
          <Card key={b.id}>
            <Link to={`/nambikai/business/${b.id}`} className="block">
              <ListRow
                icon={
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-navy">
                    <Icon name="store" size={21} />
                  </span>
                }
                title={b.name}
                subtitle={`${b.sector.toLowerCase()} · ${b.gstNumber ? 'GST registered' : 'not GST registered'} · ${b.monthlyRevenue.formatted}/mo`}
                onClick={() => {}}
              />
            </Link>
          </Card>
        ))}

        {error && (
          <Card>
            <EmptyState icon="alert" title="Couldn’t load businesses" description={error.message} />
          </Card>
        )}

        <MockBadge className="pb-3 pt-1" />
      </div>
    </>
  );
}
