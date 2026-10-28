/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
// local imports
import { MultipleSelectStore } from "./multiple_select.store";

const entities = ["a", "b", "c"].map((entityID) => ({ entityID, groupID: "g1" }));

describe("MultipleSelectStore", () => {
  let store: MultipleSelectStore;

  beforeEach(() => {
    store = new MultipleSelectStore();
  });

  describe("getSelectionStatus", () => {
    it("is empty for an empty list and when nothing is selected", () => {
      expect(store.getSelectionStatus([])).toBe("empty");
      expect(store.getSelectionStatus(["a", "b"])).toBe("empty");
    });

    it("is partial when only some of the entities are selected", () => {
      store.bulkUpdateSelectedEntityDetails([entities[0]], "add");
      expect(store.getSelectionStatus(["a", "b", "c"])).toBe("partial");
    });

    it("is complete when all entities are selected and ignores selected entities outside the list", () => {
      store.bulkUpdateSelectedEntityDetails(entities, "add");
      expect(store.getSelectionStatus(["a", "b"])).toBe("complete");
      expect(store.getSelectionStatus(["a", "z"])).toBe("partial");
    });

    it("follows selection changes", () => {
      store.bulkUpdateSelectedEntityDetails(entities, "add");
      store.updateSelectedEntityDetails(entities[1], "remove");
      expect(store.getSelectionStatus(["a", "b", "c"])).toBe("partial");
      store.clearSelection();
      expect(store.getSelectionStatus(["a", "b", "c"])).toBe("empty");
    });
  });

  describe("applyBulkUpdate", () => {
    it("applies the data to every selected entity", async () => {
      store.bulkUpdateSelectedEntityDetails([entities[0], entities[2]], "add");
      const updateEntity = vi.fn().mockResolvedValue(undefined);

      const failed = await store.applyBulkUpdate({ priority: "high" }, updateEntity);

      expect(failed).toEqual([]);
      expect(updateEntity).toHaveBeenCalledTimes(2);
      expect(updateEntity).toHaveBeenCalledWith("a", { priority: "high" });
      expect(updateEntity).toHaveBeenCalledWith("c", { priority: "high" });
    });

    it("clears the selection before the updates settle", async () => {
      store.bulkUpdateSelectedEntityDetails(entities, "add");
      const resolvers: (() => void)[] = [];
      const pending = new Promise<void>((resolve) => resolvers.push(resolve));

      const result = store.applyBulkUpdate({ state_id: "s1" }, () => pending);

      expect(store.isSelectionActive).toBe(false);
      expect(store.selectedEntityIds).toEqual([]);
      resolvers.forEach((resolve) => resolve());
      await result;
    });

    it("returns the ids of the failed updates and still updates the others", async () => {
      store.bulkUpdateSelectedEntityDetails(entities, "add");
      const updateEntity = vi.fn((entityID: string) =>
        entityID === "b" ? Promise.reject(new Error("failed")) : Promise.resolve()
      );

      const failed = await store.applyBulkUpdate({ priority: "low" }, updateEntity);

      expect(failed).toEqual(["b"]);
      expect(updateEntity).toHaveBeenCalledTimes(3);
      expect(store.isSelectionActive).toBe(false);
    });

    it("treats a synchronously throwing update as a failure", async () => {
      store.bulkUpdateSelectedEntityDetails(entities, "add");
      const updateEntity = vi.fn((entityID: string) => {
        if (entityID === "a") throw new Error("boom");
        return Promise.resolve();
      });

      const failed = await store.applyBulkUpdate({ priority: "low" }, updateEntity);

      expect(failed).toEqual(["a"]);
      expect(updateEntity).toHaveBeenCalledTimes(3);
    });

    it("does nothing without a selection", async () => {
      const updateEntity = vi.fn();

      const failed = await store.applyBulkUpdate({ priority: "low" }, updateEntity);

      expect(failed).toEqual([]);
      expect(updateEntity).not.toHaveBeenCalled();
    });
  });
});
