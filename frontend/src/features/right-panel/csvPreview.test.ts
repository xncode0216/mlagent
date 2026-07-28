import { describe, expect, it } from "vitest";

import { parseCsvPreview } from "./csvPreview";

describe("csv preview parsing", () => {
  it("splits the header row from the body", () => {
    const preview = parseCsvPreview("age,churn\n41,yes\n33,no");

    expect(preview.headers).toEqual(["age", "churn"]);
    expect(preview.rows).toEqual([
      ["41", "yes"],
      ["33", "no"],
    ]);
  });

  it("keeps commas inside a quoted field", () => {
    const preview = parseCsvPreview('name,note\n"Doe, Jane",vip');

    expect(preview.rows).toEqual([["Doe, Jane", "vip"]]);
  });

  it("unescapes a doubled quote into a single one", () => {
    const preview = parseCsvPreview('note\n"she said ""hi"""');

    expect(preview.rows).toEqual([['she said "hi"']]);
  });

  it("keeps a newline inside a quoted field on the same row", () => {
    const preview = parseCsvPreview('note,tier\n"line one\nline two",gold');

    expect(preview.rows).toEqual([["line one\nline two", "gold"]]);
  });

  it("treats CRLF as a single row break", () => {
    const preview = parseCsvPreview("age,churn\r\n41,yes\r\n33,no");

    expect(preview.headers).toEqual(["age", "churn"]);
    expect(preview.rows).toEqual([
      ["41", "yes"],
      ["33", "no"],
    ]);
  });

  it("caps the body at maxRows so a large file cannot flood the preview", () => {
    const content = ["age", ...Array.from({ length: 30 }, (_, index) => String(index))].join("\n");

    const preview = parseCsvPreview(content, 5);

    expect(preview.headers).toEqual(["age"]);
    expect(preview.rows).toHaveLength(5);
  });

  it("reports an empty header list for blank content", () => {
    expect(parseCsvPreview("")).toEqual({ headers: [], rows: [] });
    expect(parseCsvPreview("\n\n")).toEqual({ headers: [], rows: [] });
  });

  it("keeps the final row when the file has no trailing newline", () => {
    const preview = parseCsvPreview("age,churn\n41,yes");

    expect(preview.rows).toEqual([["41", "yes"]]);
  });
});
