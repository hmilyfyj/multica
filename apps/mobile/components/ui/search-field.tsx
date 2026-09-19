/**
 * Body-rendered search row for the search-enabled picker sheets.
 *
 * Why it exists: the pickers historically relied on the iOS native search
 * bar (`headerSearchBarOptions` → `UISearchController`), which has no
 * Android implementation — `react-native-screens` never reads those props
 * there, so the sheet opened with no way to filter. `usePickerSearchBar`
 * renders this component on every non-iOS platform instead, keeping the
 * same contract the native bar had (a `query` string plus a clear gesture).
 *
 * Placement contract: render it as a SIBLING of the picker's FlatList, at
 * the top of the sheet — never inside `ListHeaderComponent` (a TextInput
 * there loses focus on the first data change) and never wrapped around the
 * list (iOS' `RNSScreenContentWrapper` needs the FlatList as a direct
 * subview). See `react-native-screens#3634` and the assignee route comment
 * in `app/(app)/[workspace]/_layout.tsx`.
 *
 * Composed from existing primitives on purpose: `TextField` already carries
 * the Android text metrics (`includeFontPadding` / `textAlignVertical`) and
 * the project placeholder colour, so this adds only the magnifier and the
 * clear affordance — no new input primitive, no new dependency.
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TextField } from "@/components/ui/text-field";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { cn } from "@/lib/utils";

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Matches the iOS native bar's `autoFocus` (keyboard on mount). */
  autoFocus?: boolean;
  className?: string;
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  className,
}: SearchFieldProps) {
  return (
    <View
      className={cn(
        "flex-row items-center gap-2 border-b border-border px-4 py-2",
        className,
      )}
    >
      <Ionicons name="search" size={18} color={MOBILE_PLACEHOLDER_COLOR} />
      <TextField
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // Mirrors the iOS native bar's defaults in `usePickerSearchBar`;
        // names/emails/project titles are not sentence text.
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        className="flex-1"
      />
      {/* Clear affordance. iOS gets this from the native bar's cancel
          button, which resets the query in `onCancelButtonPress`; here the
          same reset happens through `onChangeText("")`. */}
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText("")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons
            name="close-circle"
            size={18}
            color={MOBILE_PLACEHOLDER_COLOR}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
