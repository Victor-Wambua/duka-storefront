import { Link } from 'react-router-dom';
import { PageTitle } from '../components/PageTitle';

export default function NotFound({ what = 'page' }: { what?: string }) {
  return (
    <div className="empty">
      <PageTitle title="Not found">We could not find that {what}</PageTitle>
      <p>The link may be old, or the item may have been removed.</p>
      <Link className="btn btn--primary" to="/">
        Back to the shop
      </Link>
    </div>
  );
}
