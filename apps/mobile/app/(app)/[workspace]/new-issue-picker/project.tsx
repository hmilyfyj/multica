/**
 * Project picker route for the in-progress new-issue draft. Same search-bar
 * wiring as `issue/[id]/picker/project.tsx` via `usePickerSearchBar`.
 */
import { router } from "expo-router";
import { ProjectPickerBody } from "@/components/issue/pickers/project-picker-body";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { usePickerSearchBar } from "@/lib/use-picker-search-bar";

export default function NewIssueProjectPickerRoute() {
  const project = useNewIssueDraftStore((s) => s.project);
  const setProject = useNewIssueDraftStore((s) => s.setProject);
  const { query, searchBar } = usePickerSearchBar("Search projects", {
    autoFocus: true,
  });

  return (
    <>
      {searchBar}
      <ProjectPickerBody
        value={project}
        query={query}
        onChange={(next) => {
          setProject(next);
          router.back();
        }}
      />
    </>
  );
}
