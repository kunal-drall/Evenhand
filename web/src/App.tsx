import { lazy, Suspense, type ReactElement } from "react";

// One chunk per page, so the renter's phone loads only the pay page.
const named = <K extends string>(load: () => Promise<Record<K, () => ReactElement>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const PayPage = lazy(() => import("./pages/PayPage").then((m) => ({ default: m.PayPage })));
const RentalPage = lazy(() => import("./pages/RentalPage").then((m) => ({ default: m.RentalPage })));
const OwnerPage = named(() => import("./pages/OwnerPage"), "OwnerPage");
const ShopPage = named(() => import("./pages/ShopPage"), "ShopPage");
const ArbiterPage = named(() => import("./pages/ArbiterPage"), "ArbiterPage");

type Route = { pattern: RegExp; render: (params: string[]) => ReactElement };

// Tiny path router: five routes do not justify a router dependency.
const ROUTES: Route[] = [
  { pattern: /^\/pay\/([^/]+)\/?$/, render: ([id]) => <PayPage rentalId={id ?? ""} /> },
  { pattern: /^\/r\/([^/]+)\/?$/, render: ([id]) => <RentalPage rentalId={id ?? ""} /> },
  { pattern: /^\/owner\/?$/, render: () => <OwnerPage /> },
  { pattern: /^\/shop\/?$/, render: () => <ShopPage /> },
  { pattern: /^\/arbiter\/?$/, render: () => <ArbiterPage /> },
];

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function App() {
  const path = window.location.pathname;
  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (match) return <Suspense fallback={<p className="shell">Loading…</p>}>{route.render(match.slice(1).map(safeDecode))}</Suspense>;
  }
  return <p className="shell">Page not found.</p>;
}
