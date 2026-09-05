import { ErrorBoundary } from "@/components/error-boundary";
import { RecordView } from "@/components/record-view";

export default function RecordRoute(): React.JSX.Element {
  // The record runs the linter and the timing module as well as the simulation, and only the
  // simulation call guards itself. Without a boundary an engine invariant thrown by either of the
  // other two unmounts the whole route to a blank page instead of showing what failed.
  return (
    <ErrorBoundary>
      <RecordView />
    </ErrorBoundary>
  );
}
