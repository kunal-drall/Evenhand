import type { ReactElement } from "react";
import { OwnerPage } from "./pages/OwnerPage";
import { PayPage } from "./pages/PayPage";
import { RentalPage } from "./pages/RentalPage";
import { ShopPage } from "./pages/ShopPage";

type Route = { pattern: RegExp; render: (params: string[]) => ReactElement };

// Tiny path router: four routes do not justify a router dependency.
const ROUTES: Route[] = [
  { pattern: /^\/pay\/([^/]+)\/?$/, render: ([id]) => <PayPage rentalId={id ?? ""} /> },
  { pattern: /^\/r\/([^/]+)\/?$/, render: ([id]) => <RentalPage rentalId={id ?? ""} /> },
  { pattern: /^\/owner\/?$/, render: () => <OwnerPage /> },
  { pattern: /^\/shop\/?$/, render: () => <ShopPage /> },
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
    if (match) return route.render(match.slice(1).map(safeDecode));
  }
  return <p>Page not found.</p>;
}
