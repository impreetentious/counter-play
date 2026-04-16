import type { Metadata } from "next";
import { CasebookView } from "@/components/casebook-view";

export const metadata: Metadata = {
  title: "Casebook",
  description:
    "Five published findings from the compensation literature, encoded as scenarios this engine runs — the bibliography as demonstrations rather than citations.",
};

export default function CasebookRoute(): React.JSX.Element {
  return <CasebookView />;
}
