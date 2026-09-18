/**
 * Platform-aware search bar for the search-enabled picker routes
 * (issue assignee / label / project, project lead, mention). Returns the
 * current query plus the search chrome the calling route must render above
 * its list.
 *
 * Returns `{ query, searchBar }`:
 *   - iOS: `searchBar` is `null` — the search field is the native
 *     `UISearchController` hosted by the Stack header
 *     (`navigation.setOptions({ headerSearchBarOptions })`, requires the
 *     route to register `headerShown: true` + a `title` in the layout).
 *   - Android / web: `searchBar` is a `<SearchField>` element to render as
 *     a sibling ABOVE the list. `headerSearchBarOptions` has no
 *     implementation in `react-native-screens` on Android — the props are
 *     accepted and dropped — so without this the sheets would open with no
 *     way to filter.
 *
 * Call sites are identical on both platforms:
 *
 *   const { query, searchBar } = usePickerSearchBar("Search people", { autoFocus: true });
 *   return (
 *     <>
 *       {searchBar}
 *       <AssigneePickerBody value={value} query={query} onChange={…} />
 *     </>
 *   );
 *
 * On iOS `searchBar` is `null`, so the fragment collapses to the body alone
 * and the FlatList stays the route's direct child — required by
 * `react-native-screens` (#3634) for the native header offset to apply.
 *
 * Why this exists rather than inlining `setOptions` / an input in every
 * route:
 *   - Cancel/clear contract: on iOS `cancelSearch()` clears the native text
 *     but does NOT fire `onChangeText`, so the route MUST reset query state
 *     in `onCancelButtonPress`; on Android the field's clear button resets
 *     it through `onChangeText("")`. One place to keep the two in sync.
 *   - Sensible defaults (autoCapitalize: "none", hideWhenScrolling: false)
 *     match the standard picker pattern; one place to revise.
 *   - The platform split stays here, so no route file branches on
 *     `Platform.OS`.
 *
 * Pair with `useScrollToTopOnChange` in the body to reset the list scroll
 * position when the filter changes.
 */
import { useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";
import type {
  NativeSyntheticEvent,
  TextInputFocusEventData,
} from "react-native";
import { useNavigation } from "expo-router";
import { SearchField } from "@/components/ui/search-field";

export interface PickerSearchBar {
  /** Current filter text; the body filters its rows on this. */
  query: string;
  /** Search chrome to render above the list, or `null` when the platform's
   *  own header already provides it (iOS). */
  searchBar: ReactNode;
}

export function usePickerSearchBar(
  placeholder: string,
  options?: { autoFocus?: boolean },
): PickerSearchBar {
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const autoFocus = options?.autoFocus;
  const isIOS = Platform.OS === "ios";

  useLayoutEffect(() => {
    // Android/web have no native search bar to configure; `SearchField`
    // below carries the state instead.
    if (!isIOS) return;

    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder,
        autoCapitalize: "none",
        hideWhenScrolling: false,
        // Opt-in: pickers whose primary action is typing (assignee, label,
        // project, lead) set this so the keyboard appears on mount. Apple
        // HIG cautions against auto-keyboard for browse-first lists; pass
        // `autoFocus: true` only when the picker is search-first.
        autoFocus,
        onChangeText: (e: NativeSyntheticEvent<TextInputFocusEventData>) =>
          setQuery(e.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [navigation, placeholder, autoFocus, isIOS]);

  const searchBar = isIOS ? null : (
    <SearchField
      value={query}
      onChangeText={setQuery}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  );

  return { query, searchBar };
}
