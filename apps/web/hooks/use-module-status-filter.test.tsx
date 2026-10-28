/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
// local imports
import { moduleStatusFiltersStorageKey, useModuleStatusFilter } from "./use-module-status-filter";

const STORAGE_KEY = moduleStatusFiltersStorageKey("p1");

const readSavedStatuses = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");

const createWrapper = (initialEntry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/:workspaceSlug/projects/:projectId/modules" element={children} />
        </Routes>
      </MemoryRouter>
    );
  };

const renderFilter = (initialEntry: string, initialStatuses?: string) =>
  renderHook(
    () => ({
      filter: useModuleStatusFilter(initialStatuses),
      location: useLocation(),
    }),
    { wrapper: createWrapper(initialEntry) }
  );

describe("useModuleStatusFilter", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads the statuses from the URL", () => {
    const { result } = renderFilter("/ws/projects/p1/modules?status=planned,paused");

    expect(result.current.filter.activeStatuses).toEqual(["planned", "paused"]);
  });

  it("ignores unknown values", () => {
    const { result } = renderFilter("/ws/projects/p1/modules?status=planned,foo");

    expect(result.current.filter.activeStatuses).toEqual(["planned"]);
  });

  it("switches a status on and off", async () => {
    const { result } = renderFilter("/ws/projects/p1/modules?view=1");

    act(() => result.current.filter.switchStatus("planned"));
    await waitFor(() => expect(result.current.location.search).toContain("status=planned"));
    expect(result.current.location.search).toContain("view=1");

    act(() => result.current.filter.switchStatus("planned"));
    await waitFor(() => expect(result.current.location.search).not.toContain("status"));
    expect(result.current.location.search).toContain("view=1");
  });

  it("applies initialStatuses", async () => {
    const { result } = renderFilter("/ws/projects/p1/modules", "completed");

    await waitFor(() => expect(result.current.location.search).toContain("status=completed"));
  });

  it("restores the saved statuses and keeps other params", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["paused"]));
    const { result } = renderFilter("/ws/projects/p1/modules?view=1");

    await waitFor(() => expect(result.current.location.search).toBe("?view=1&status=paused"));
  });

  it("prefers the URL and saves it", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["paused"]));
    const { result } = renderFilter("/ws/projects/p1/modules?status=planned");

    expect(result.current.filter.activeStatuses).toEqual(["planned"]);
    await waitFor(() => expect(readSavedStatuses()).toEqual(["planned"]));
    expect(result.current.location.search).toBe("?status=planned");
  });

  it("updates the URL and the saved statuses when switching", async () => {
    const { result } = renderFilter("/ws/projects/p1/modules");

    act(() => result.current.filter.switchStatus("completed"));
    await waitFor(() => expect(result.current.location.search).toContain("status=completed"));
    expect(readSavedStatuses()).toEqual(["completed"]);
  });
});
