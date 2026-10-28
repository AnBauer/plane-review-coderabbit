/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
// local imports
import { useCycleDateUpdate } from "./use-cycle-date-update";

const mocks = vi.hoisted(() => ({
  setToast: vi.fn(),
  updateCycleDetails: vi.fn(),
  cycleDateCheck: vi.fn(),
}));

vi.mock("@plane/blocks/toast", () => ({ setToast: mocks.setToast }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-cycle", () => ({ useCycle: () => ({ updateCycleDetails: mocks.updateCycleDetails }) }));
vi.mock("@/services/cycle.service", () => ({
  CycleService: class {
    cycleDateCheck = mocks.cycleDateCheck;
  },
}));

const renderUpdate = () => renderHook(() => useCycleDateUpdate("ws", "p1", "c1")).result.current;

const lastToast = () => mocks.setToast.mock.calls.at(-1)?.[0];

describe("useCycleDateUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cycleDateCheck.mockResolvedValue({ status: true });
    mocks.updateCycleDetails.mockResolvedValue({});
  });

  it("checks the dates and saves a valid range", async () => {
    const update = renderUpdate();

    const saved = await update({ from: new Date(2026, 10, 2), to: new Date(2026, 10, 15) });

    expect(saved).toBe(true);
    expect(mocks.cycleDateCheck).toHaveBeenCalledWith("ws", "p1", {
      start_date: "2026-11-02",
      end_date: "2026-11-15",
      cycle_id: "c1",
    });
    expect(mocks.updateCycleDetails).toHaveBeenCalledWith("ws", "p1", "c1", {
      start_date: "2026-11-02",
      end_date: "2026-11-15",
    });
    expect(lastToast()).toMatchObject({ type: "success" });
  });

  it("sends the picked calendar days regardless of the time of day", async () => {
    const update = renderUpdate();

    // late evening / early morning local times must not roll over to another day
    await update({ from: new Date(2026, 10, 2, 23, 59), to: new Date(2026, 10, 3, 0, 1) });

    expect(mocks.updateCycleDetails).toHaveBeenCalledWith("ws", "p1", "c1", {
      start_date: "2026-11-02",
      end_date: "2026-11-03",
    });
  });

  it("accepts a one-day range", async () => {
    const update = renderUpdate();

    expect(await update({ from: new Date(2026, 10, 2), to: new Date(2026, 10, 2) })).toBe(true);
  });

  it("rejects an end date before the start date", async () => {
    const update = renderUpdate();

    const saved = await update({ from: new Date(2026, 10, 15), to: new Date(2026, 10, 2) });

    expect(saved).toBe(false);
    expect(mocks.cycleDateCheck).not.toHaveBeenCalled();
    expect(mocks.updateCycleDetails).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({
      type: "error",
      message: "project_cycles.action.update.error.end_before_start",
    });
  });

  it("rejects a half-set range", async () => {
    const update = renderUpdate();

    expect(await update({ from: new Date(2026, 10, 2), to: null })).toBe(false);
    expect(mocks.updateCycleDetails).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ type: "error" });
  });

  it("rejects a range that overlaps another cycle", async () => {
    mocks.cycleDateCheck.mockResolvedValue({ status: false });
    const update = renderUpdate();

    const saved = await update({ from: new Date(2026, 10, 2), to: new Date(2026, 10, 15) });

    expect(saved).toBe(false);
    expect(mocks.updateCycleDetails).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({
      type: "error",
      message: "project_cycles.action.update.error.already_exists",
    });
  });

  it("shows an error when the date check request fails", async () => {
    mocks.cycleDateCheck.mockRejectedValue(new Error("network"));
    const update = renderUpdate();

    expect(await update({ from: new Date(2026, 10, 2), to: new Date(2026, 10, 15) })).toBe(false);
    expect(mocks.updateCycleDetails).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ type: "error" });
  });

  it("shows an error when saving fails", async () => {
    mocks.updateCycleDetails.mockRejectedValue(new Error("boom"));
    const update = renderUpdate();

    expect(await update({ from: new Date(2026, 10, 2), to: new Date(2026, 10, 15) })).toBe(false);
    expect(lastToast()).toMatchObject({
      type: "error",
      message: "project_cycles.action.update.failed.description",
    });
  });

  it("clears both dates without a date check", async () => {
    const update = renderUpdate();

    expect(await update({ from: null, to: null })).toBe(true);
    expect(mocks.cycleDateCheck).not.toHaveBeenCalled();
    expect(mocks.updateCycleDetails).toHaveBeenCalledWith("ws", "p1", "c1", { start_date: null, end_date: null });
  });
});
