// Demo shop: a separate rental site that adds Evenhand deposits using only web/sdk (about 20 lines below).
import { useEffect, useState } from "react";
import { createEvenhand, type Rental } from "../../sdk/evenhand";

const evenhand = createEvenhand(); // same origin here; a real shop passes { baseUrl }
const SHOP_OWNER = new URLSearchParams(location.search).get("owner") ?? (import.meta.env.VITE_SHOP_OWNER as string | undefined);

export function ShopPage() {
  const [booking, setBooking] = useState<{ rentalId: string; payUrl: string }>();
  const [rental, setRental] = useState<Rental>();
  const [error, setError] = useState<string>();
  useEffect(() => (booking ? evenhand.watch(booking.rentalId, setRental) : undefined), [booking]);

  const rent = () =>
    evenhand
      .createRental({ owner: SHOP_OWNER!, item: "Laptop, 3 days", depositUsd: 200, returnBy: new Date(Date.now() + 3 * 86_400_000) })
      .then(setBooking, (e: Error) => setError(e.message));

  return (
    <div className="shop">
      <header className="shop-head">Northwind Gear Rentals</header>
      <div className="shop-item">
        <div className="shop-photo" aria-hidden />
        <div>
          <h1>14" laptop</h1>
          <p>$18 / day · $200 refundable deposit, checked by a neutral inspector</p>
          {!SHOP_OWNER ? (
            <p className="meta">Add ?owner=0x… (the shop's payout address) to the URL.</p>
          ) : !booking ? (
            <button className="primary" onClick={() => void rent()}>Rent for 3 days</button>
          ) : (
            <div className="shop-pay">
              <div className="qr" dangerouslySetInnerHTML={{ __html: evenhand.qrSvg(booking.payUrl) }} />
              <p>
                Scan to pay the deposit, or open <a href={booking.payUrl}>the payment link</a>.
              </p>
              <p className="meta">Status: {rental ? evenhand.describe(rental) : "…"}</p>
            </div>
          )}
          {error && <p className="meta">{error}</p>}
        </div>
      </div>
    </div>
  );
}
