/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEqual, set } from "lodash-es";
import { action, computed, observable, makeObservable, runInAction, reaction, toJS, when } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import { CYCLE_STATUS } from "@plane/constants";
import type { TCycleDisplayFilters, TCycleFilters, TCycleFiltersByState } from "@plane/types";
// local storage
import { storage } from "@/lib/local-storage";
// store
import type { CoreRootStore } from "./root.store";

export const CYCLE_STATUS_SEARCH_PARAM = "cycle_status";

export const cycleFiltersStorageKey = (userId: string) => `cycle_filters:${userId}`;

const CYCLE_STATUS_VALUES = new Set<string>(CYCLE_STATUS.map((status) => status.value));

const getStoredFilters = (userId: string): Record<string, TCycleFilters> => {
  const value = storage.get(cycleFiltersStorageKey(userId));
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, TCycleFilters>;
  } catch {
    return {};
  }
};

export interface ICycleFilterStore {
  // observables
  displayFilters: Record<string, TCycleDisplayFilters>;
  filters: Record<string, TCycleFiltersByState>;
  savedFilters: Record<string, TCycleFilters>;
  searchQuery: string;
  archivedCyclesSearchQuery: string;
  // computed
  currentProjectDisplayFilters: TCycleDisplayFilters | undefined;
  currentProjectFilters: TCycleFilters | undefined;
  currentProjectArchivedFilters: TCycleFilters | undefined;
  // computed functions
  getDisplayFiltersByProjectId: (projectId: string) => TCycleDisplayFilters | undefined;
  getFiltersByProjectId: (projectId: string) => TCycleFilters | undefined;
  getArchivedFiltersByProjectId: (projectId: string) => TCycleFilters | undefined;
  isProjectFilterSaved: (projectId: string) => boolean;
  // actions
  updateDisplayFilters: (projectId: string, displayFilters: TCycleDisplayFilters) => void;
  updateFilters: (projectId: string, filters: TCycleFilters, state?: keyof TCycleFiltersByState) => void;
  updateSearchQuery: (query: string) => void;
  updateArchivedCyclesSearchQuery: (query: string) => void;
  clearAllFilters: (projectId: string, state?: keyof TCycleFiltersByState) => void;
  hydrateProjectFilters: (projectId: string) => Promise<void>;
  applyUrlFilters: () => void;
  saveFilters: () => void;
}

export class CycleFilterStore implements ICycleFilterStore {
  // observables
  displayFilters: Record<string, TCycleDisplayFilters> = {};
  filters: Record<string, TCycleFiltersByState> = {};
  savedFilters: Record<string, TCycleFilters> = {};
  searchQuery: string = "";
  archivedCyclesSearchQuery: string = "";
  // root store
  rootStore: CoreRootStore;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      displayFilters: observable,
      filters: observable,
      savedFilters: observable,
      searchQuery: observable.ref,
      archivedCyclesSearchQuery: observable.ref,
      // computed
      currentProjectDisplayFilters: computed,
      currentProjectFilters: computed,
      currentProjectArchivedFilters: computed,
      // actions
      updateDisplayFilters: action,
      updateFilters: action,
      updateSearchQuery: action,
      updateArchivedCyclesSearchQuery: action,
      clearAllFilters: action,
    });
    // root store
    this.rootStore = _rootStore;
    // initialize display filters of the current project
    reaction(
      () => this.rootStore.router.projectId,
      (projectId) => {
        if (!projectId) return;
        this.initProjectCycleFilters(projectId);
        this.searchQuery = "";
        void this.hydrateProjectFilters(projectId);
      }
    );
    // apply filters shared through the url
    when(
      () => Boolean(this.rootStore.router.searchParams[CYCLE_STATUS_SEARCH_PARAM]),
      () => this.applyUrlFilters()
    );
    // save filters of the current project
    reaction(
      () => this.filters,
      () => this.saveFilters()
    );
  }

  /**
   * @description get display filters of the current project
   */
  get currentProjectDisplayFilters() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId) return;
    return this.displayFilters[projectId];
  }

  /**
   * @description get filters of the current project
   */
  get currentProjectFilters() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId) return;
    return this.filters[projectId]?.default ?? {};
  }

  /**
   * @description get archived filters of the current project
   */
  get currentProjectArchivedFilters() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId) return;
    return this.filters[projectId].archived;
  }

  /**
   * @description get display filters of a project by projectId
   * @param {string} projectId
   */
  getDisplayFiltersByProjectId = computedFn((projectId: string) => this.displayFilters[projectId]);

  /**
   * @description get filters of a project by projectId
   * @param {string} projectId
   */
  getFiltersByProjectId = computedFn((projectId: string) => this.filters[projectId]?.default ?? {});

  /**
   * @description get archived filters of a project by projectId
   * @param {string} projectId
   */
  getArchivedFiltersByProjectId = computedFn((projectId: string) => this.filters[projectId].archived);

  /**
   * @description check if the filters of a project match the saved filters
   * @param {string} projectId
   */
  isProjectFilterSaved = computedFn((projectId: string) => {
    const savedFilters = this.savedFilters[projectId];
    if (!savedFilters) return false;
    return isEqual(toJS(this.filters[projectId]?.default ?? {}), toJS(savedFilters));
  });

  /**
   * @description initialize display filters and filters of a project
   * @param {string} projectId
   */
  initProjectCycleFilters = (projectId: string) => {
    const displayFilters = this.getDisplayFiltersByProjectId(projectId);
    runInAction(() => {
      this.displayFilters[projectId] = {
        active_tab: displayFilters?.active_tab || "active",
        layout: displayFilters?.layout || "list",
      };
      this.filters[projectId] = this.filters[projectId] ?? {
        default: {},
        archived: {},
      };
    });
  };

  /**
   * @description restore the saved filters of a project for the current user
   * @param {string} projectId
   */
  hydrateProjectFilters = async (projectId: string) => {
    const current = { ...this.filters[projectId]?.default };
    await when(() => !!this.rootStore.user.data?.id);
    const userId = this.rootStore.user.data?.id;
    if (!userId) return;
    const stored = getStoredFilters(userId)[projectId];
    if (!stored) return;
    this.filters[projectId] = { ...this.filters[projectId], default: { ...current, ...stored } };
    runInAction(() => {
      this.savedFilters[projectId] = stored;
    });
  };

  /**
   * @description apply the status filter from the url to the current project
   */
  applyUrlFilters = () => {
    const projectId = this.rootStore.router.projectId;
    const value = this.rootStore.router.searchParams[CYCLE_STATUS_SEARCH_PARAM];
    if (!projectId || !value) return;
    const status = value.split(",").filter((item) => CYCLE_STATUS_VALUES.has(item));
    if (status.length === 0) return;
    this.updateFilters(projectId, { status });
  };

  /**
   * @description save the filters of the current project for the current user
   */
  saveFilters = () => {
    const projectId = this.rootStore.router.projectId;
    const userId = this.rootStore.user.data?.id;
    if (!projectId || !userId) return;
    const projectFilters = toJS(this.filters[projectId]?.default ?? {});
    storage.set(cycleFiltersStorageKey(userId), { ...getStoredFilters(userId), [projectId]: projectFilters });
    runInAction(() => {
      this.savedFilters[projectId] = projectFilters;
    });
  };

  /**
   * @description update display filters of a project
   * @param {string} projectId
   * @param {TCycleDisplayFilters} displayFilters
   */
  updateDisplayFilters = (projectId: string, displayFilters: TCycleDisplayFilters) => {
    runInAction(() => {
      Object.keys(displayFilters).forEach((key) => {
        set(this.displayFilters, [projectId, key], displayFilters[key as keyof TCycleDisplayFilters]);
      });
    });
  };

  /**
   * @description update filters of a project
   * @param {string} projectId
   * @param {TCycleFilters} filters
   */
  updateFilters = (projectId: string, filters: TCycleFilters, state: keyof TCycleFiltersByState = "default") => {
    runInAction(() => {
      Object.keys(filters).forEach((key) => {
        set(this.filters, [projectId, state, key], filters[key as keyof TCycleFilters]);
      });
    });
  };

  /**
   * @description update search query
   * @param {string} query
   */
  updateSearchQuery = (query: string) => (this.searchQuery = query);

  /**
   * @description update archived search query
   * @param {string} query
   */
  updateArchivedCyclesSearchQuery = (query: string) => (this.archivedCyclesSearchQuery = query);

  /**
   * @description clear all filters of a project
   * @param {string} projectId
   */
  clearAllFilters = (projectId: string, state: keyof TCycleFiltersByState = "default") => {
    runInAction(() => {
      this.filters[projectId][state] = {};
    });
  };
}
