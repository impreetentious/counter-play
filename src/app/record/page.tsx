import { brandName } from "@/brand";

export default function RecordStub(): React.JSX.Element {
  return (
    <main className="record-stub">
      <p className="eyebrow">Design record</p>
      <h1>{brandName}</h1>
      <p>A printable decision record will appear here once a scenario has been simulated.</p>
    </main>
  );
}
