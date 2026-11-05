/** Renter pays the deposit with one signature (C5). */
export function PayPage({ rentalId }: { rentalId: string }) {
  return (
    <main>
      <h1>Pay deposit</h1>
      <p>Rental {rentalId}</p>
    </main>
  );
}
