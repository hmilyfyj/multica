/**
 * Pure picker body for due-date. Wraps the native UIDatePicker on iOS and the
 * native date dialog on Android. The caller (a formSheet route on iOS, a
 * full-screen modal on Android) renders the Done / Clear actions in its own
 * header area — this body only handles the picker + the local draft state.
 *
 * due_date is a calendar day (date-only "YYYY-MM-DD", no time/timezone — see
 * @multica/core/issues/date and GH #3618). Mirrors web's
 * packages/views/issues/components/pickers/due-date-picker.tsx: read the stored
 * day into a local-midnight Date for the picker, write back the picked local
 * day as a date-only string.
 */
import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { Platform, Pressable, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { Text } from "@/components/ui/text";
import {
  toDateOnly,
  dateOnlyToLocalDate,
  formatDateOnly,
} from "@multica/core/issues/date";

interface Props {
  value: string | null;
}

export interface DueDatePickerBodyHandle {
  /** Returns the currently-displayed day as a date-only "YYYY-MM-DD" string. */
  getIso: () => string;
}

function toLocalDay(value: string | null): Date {
  return dateOnlyToLocalDate(value) ?? new Date();
}

export const DueDatePickerBody = forwardRef<DueDatePickerBodyHandle, Props>(
  function DueDatePickerBody({ value }, ref) {
    const [draft, setDraft] = useState<Date>(() => toLocalDay(value));

    useEffect(() => {
      setDraft(toLocalDay(value));
    }, [value]);

    useImperativeHandle(ref, () => ({
      getIso: () => toDateOnly(draft),
    }));

    // Android has no inline date picker: every `display` mode is a system
    // dialog, and a dialog opened from inside a formSheet never takes input
    // (that is why the route is a full-screen modal on Android — see the
    // DUE_DATE_OPTIONS comment in app/(app)/[workspace]/_layout.tsx). The row
    // opens the dialog on demand, which is how Android asks for a calendar day
    // in the first place.
    if (Platform.OS === "android") {
      return (
        <View className="flex-1 px-4 pt-1">
          <Pressable
            onPress={() => {
              DateTimePickerAndroid.open({
                value: draft,
                mode: "date",
                onChange: (event, selected) => {
                  if (event.type === "set" && selected) setDraft(selected);
                },
              });
            }}
            className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3 active:bg-secondary"
          >
            <Text className="text-base text-foreground">
              {formatDateOnly(toDateOnly(draft), {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
            <Text className="text-sm text-muted-foreground">Change</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View className="flex-1 items-center pt-2">
        <DateTimePicker
          value={draft}
          mode="date"
          display="inline"
          onChange={(_event, selected) => {
            if (selected) setDraft(selected);
          }}
        />
      </View>
    );
  },
);
