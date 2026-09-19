// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLOR_PRESETS,
  labelColorOf,
  normalizeLabelColor,
} from "./label-color";

describe("normalizeLabelColor", () => {
  it("canonicalises the forms the server accepts", () => {
    expect(normalizeLabelColor("#3B82F6")).toBe("#3b82f6");
    expect(normalizeLabelColor("3b82f6")).toBe("#3b82f6");
    expect(normalizeLabelColor("  #3b82f6  ")).toBe("#3b82f6");
  });

  // The server's regex is strict on purpose — a chip renders the value
  // straight into `backgroundColor` — so the field must refuse everything the
  // server would 400, including CSS that would be an injection surface.
  it("rejects everything the server's hex regex rejects", () => {
    for (const raw of [
      "",
      "#",
      "#fff",
      "#3b82f",
      "#3b82f66",
      "rgb(1,2,3)",
      "red",
      "#3b82fz",
      "url(#x)",
    ]) {
      expect(normalizeLabelColor(raw)).toBeNull();
    }
  });
});

describe("labelColorOf", () => {
  it("keeps a stored colour as-is", () => {
    expect(labelColorOf({ color: "#ec4899" })).toBe("#ec4899");
  });

  it("falls back to the palette's neutral so the chip stays visible", () => {
    expect(labelColorOf({ color: "" })).toBe(LABEL_COLOR_PRESETS[0]);
    expect(labelColorOf({ color: "not-a-colour" })).toBe(LABEL_COLOR_PRESETS[0]);
  });
});

// Selecting a preset writes it into the hex field, which re-runs the same
// normaliser before submitting — a preset that is not already canonical would
// make the swatch and the field disagree the moment it is picked.
it("ships a palette the normaliser accepts unchanged", () => {
  for (const preset of LABEL_COLOR_PRESETS) {
    expect(normalizeLabelColor(preset)).toBe(preset);
  }
});

it("starts new labels on a canonical colour", () => {
  expect(normalizeLabelColor(DEFAULT_LABEL_COLOR)).toBe(DEFAULT_LABEL_COLOR);
});
