/**
 * Assignee picker route for the in-progress new-issue draft. See ./status.tsx.
 * Same search-bar wiring as `issue/[id]/picker/assignee.tsx` via
 * `usePickerSearchBar`: iOS uses the native nav header + UISearchController
 * (registered in `../_layout.tsx`), other platforms render the shared
 * `SearchField` above the list.
 */
import { router } from "expo-router";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { usePickerSearchBar } from "@/lib/use-picker-search-bar";

export default function NewIssueAssigneePickerRoute() {
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const setAssignee = useNewIssueDraftStore((s) => s.setAssignee);
  const { query, searchBar } = usePickerSearchBar("Search people", {
    autoFocus: true,
  });

  return (
    <>
      {searchBar}
      <AssigneePickerBody
        value={assignee}
        query={query}
        onChange={(next) => {
          setAssignee(next);
          router.back();
        }}
      />
    </>
  );
}
