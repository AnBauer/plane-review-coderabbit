/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observable } from "mobx";
import { beforeEach, describe, expect, it } from "vitest";
// store
import { CYCLE_STATUS_SEARCH_PARAM, CycleFilterStore, cycleFiltersStorageKey } from "./cycle_filter.store";
import type { CoreRootStore } from "./root.store";
import { RouterStore } from "./router.store";

const createStore = () => {
  const router = new RouterStore();
  const user = observable({ data: { id: "u1" } as { id: string } | undefined });
  const store = new CycleFilterStore({ router, user } as unknown as CoreRootStore);
  return { router, store };
};

describe("CycleFilterStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores saved filters for the current user", async () => {
    window.localStorage.setItem(cycleFiltersStorageKey("u1"), JSON.stringify({ p1: { status: ["current"] } }));
    const { router, store } = createStore();
    router.setQuery({ projectId: "p1" });

    await store.hydrateProjectFilters("p1");

    expect(store.getFiltersByProjectId("p1").status).toEqual(["current"]);
  });

  it("reports restored filters as saved", async () => {
    window.localStorage.setItem(cycleFiltersStorageKey("u1"), JSON.stringify({ p1: { status: ["current"] } }));
    const { router, store } = createStore();
    router.setQuery({ projectId: "p1" });

    await store.hydrateProjectFilters("p1");

    expect(store.isProjectFilterSaved("p1")).toBe(true);
  });

  it("applies the status from the URL", () => {
    const { router, store } = createStore();
    router.setQuery({ projectId: "p1" });

    router.setSearchParams({ [CYCLE_STATUS_SEARCH_PARAM]: "upcoming" });

    expect(store.getFiltersByProjectId("p1").status).toEqual(["upcoming"]);
  });

  it("writes the current filters to storage", () => {
    const { router, store } = createStore();
    router.setQuery({ projectId: "p1" });
    store.updateFilters("p1", { status: ["completed"] });

    store.saveFilters();

    const stored = JSON.parse(window.localStorage.getItem(cycleFiltersStorageKey("u1")) ?? "{}");
    expect(stored).toEqual({ p1: { status: ["completed"] } });
    expect(store.isProjectFilterSaved("p1")).toBe(true);
  });
});
