// squadrules-compat-surface: references the persisted app-space id space:kairos-app stored in existing Qdrant points
import { describe, expect, it } from "vitest";
import { browseAdaptersFromSpaces } from "../../src/ui/utils/browse-adapters";
import type { SpaceInfo } from "../../src/ui/hooks/useSpaces";

describe("browseAdaptersFromSpaces", () => {
  it("dedupes same adapter_id across spaces (keeps higher layer_count)", () => {
    const spaces: SpaceInfo[] = [
      {
        name: "Personal",
        space_id: "user:r:u1",
        type: "personal",
        adapter_count: 1,
        adapters: [{ adapter_id: "abc", title: "Create New", layer_count: 2 }],
      },
      {
        name: "App",
        space_id: "space:kairos-app",
        type: "app",
        adapter_count: 1,
        adapters: [{ adapter_id: "abc", title: "Create New", layer_count: 5 }],
      },
    ];
    const { browseAdapters, countsByLetter } = browseAdaptersFromSpaces(spaces);
    expect(browseAdapters).toHaveLength(1);
    expect(browseAdapters[0]!.layer_count).toBe(5);
    expect(countsByLetter["C"]).toBe(1);
  });

  it("keeps distinct adapter_ids with same title", () => {
    const spaces: SpaceInfo[] = [
      {
        name: "A",
        space_id: "group:r:g1",
        type: "group",
        adapter_count: 2,
        adapters: [
          { adapter_id: "id-1", title: "Same Title", layer_count: 1 },
          { adapter_id: "id-2", title: "Same Title", layer_count: 1 },
        ],
      },
    ];
    const { browseAdapters, countsByLetter } = browseAdaptersFromSpaces(spaces);
    expect(browseAdapters).toHaveLength(2);
    expect(countsByLetter["S"]).toBe(2);
  });

  it("retains adapters with empty adapter_id (no dedupe)", () => {
    const spaces: SpaceInfo[] = [
      {
        name: "X",
        space_id: "space:x",
        type: "other",
        adapter_count: 2,
        adapters: [
          { adapter_id: "", title: "Alpha", layer_count: 1 },
          { adapter_id: "", title: "Beta", layer_count: 1 },
        ],
      },
    ];
    const { browseAdapters } = browseAdaptersFromSpaces(spaces);
    expect(browseAdapters).toHaveLength(2);
  });

  it("handles undefined spaces", () => {
    const { browseAdapters, countsByLetter } = browseAdaptersFromSpaces(undefined);
    expect(browseAdapters).toEqual([]);
    expect(countsByLetter["A"]).toBe(0);
  });
});
