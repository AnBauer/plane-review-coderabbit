/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { differenceWith, remove, isEqual } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// hooks
import type { TEntityDetails } from "@/hooks/use-multiple-select";
// services
import { IssueService } from "@/services/issue";

export type IMultipleSelectStore = {
  // computed functions
  isSelectionActive: boolean;
  selectedEntityIds: string[];
  // helper actions
  getIsEntitySelected: (entityID: string) => boolean;
  getIsEntityActive: (entityID: string) => boolean;
  getLastSelectedEntityDetails: () => TEntityDetails | null;
  getPreviousActiveEntity: () => TEntityDetails | null;
  getNextActiveEntity: () => TEntityDetails | null;
  getActiveEntityDetails: () => TEntityDetails | null;
  getEntityDetailsFromEntityID: (entityID: string) => TEntityDetails | null;
  // entity actions
  updateSelectedEntityDetails: (entityDetails: TEntityDetails, action: "add" | "remove") => void;
  bulkUpdateSelectedEntityDetails: (entitiesList: TEntityDetails[], action: "add" | "remove") => void;
  updateLastSelectedEntityDetails: (entityDetails: TEntityDetails | null) => void;
  updatePreviousActiveEntity: (entityDetails: TEntityDetails | null) => void;
  updateNextActiveEntity: (entityDetails: TEntityDetails | null) => void;
  updateActiveEntityDetails: (entityDetails: TEntityDetails | null) => void;
  clearSelection: () => void;
  // bulk actions
  getSelectionStatus: (entityIDs: string[]) => "empty" | "partial" | "complete";
  applyBulkUpdate: <T>(data: T, updateEntity: (entityID: string, data: T) => Promise<unknown>) => Promise<string[]>;
};

/**
 * @description the MultipleSelectStore manages multiple selection states by keeping track of the selected entities and providing a bunch of helper functions and actions to maintain the selected states
 * @description use the useMultipleSelectStore custom hook to access the observables
 * @description use the useMultipleSelect custom hook for added functionality on top of the store, including-
 * 1. Keyboard and mouse interaction
 * 2. Clear state on route change
 */
export class MultipleSelectStore implements IMultipleSelectStore {
  // observables
  selectedEntityDetails: TEntityDetails[] = [];
  lastSelectedEntityDetails: TEntityDetails | null = null;
  previousActiveEntity: TEntityDetails | null = null;
  nextActiveEntity: TEntityDetails | null = null;
  activeEntityDetails: TEntityDetails | null = null;
  // service
  issueService;

  constructor() {
    makeObservable(this, {
      // observables
      selectedEntityDetails: observable,
      lastSelectedEntityDetails: observable,
      previousActiveEntity: observable,
      nextActiveEntity: observable,
      activeEntityDetails: observable,
      // computed functions
      isSelectionActive: computed,
      selectedEntityIds: computed,
      // actions
      updateSelectedEntityDetails: action,
      bulkUpdateSelectedEntityDetails: action,
      updateLastSelectedEntityDetails: action,
      updatePreviousActiveEntity: action,
      updateNextActiveEntity: action,
      updateActiveEntityDetails: action,
      clearSelection: action,
    });

    this.issueService = new IssueService();
  }

  get isSelectionActive() {
    return this.selectedEntityDetails.length > 0;
  }

  get selectedEntityIds() {
    return this.selectedEntityDetails.map((en) => en.entityID);
  }

  // helper actions
  /**
   * @description returns if the entity is selected or not
   * @param {string} entityID
   * @returns {boolean}
   */
  getIsEntitySelected = computedFn((entityID: string): boolean =>
    this.selectedEntityDetails.some((en) => en.entityID === entityID)
  );

  /**
   * @description returns if the entity is active or not
   * @param {string} entityID
   * @returns {boolean}
   */
  getIsEntityActive = computedFn((entityID: string): boolean => this.activeEntityDetails?.entityID === entityID);

  /**
   * @description get the last selected entity details
   * @returns {TEntityDetails}
   */
  getLastSelectedEntityDetails = computedFn(() => this.lastSelectedEntityDetails);

  /**
   * @description get the details of the entity preceding the active entity
   * @returns {TEntityDetails}
   */
  getPreviousActiveEntity = computedFn(() => this.previousActiveEntity);

  /**
   * @description get the details of the entity succeeding the active entity
   * @returns {TEntityDetails}
   */
  getNextActiveEntity = computedFn(() => this.nextActiveEntity);

  /**
   * @description get the active entity details
   * @returns {TEntityDetails}
   */
  getActiveEntityDetails = computedFn(() => this.activeEntityDetails);

  /**
   * @description get the entity details from entityID
   * @param {string} entityID
   * @returns {TEntityDetails | null}
   */
  getEntityDetailsFromEntityID = computedFn(
    (entityID: string): TEntityDetails | null =>
      this.selectedEntityDetails.find((en) => en.entityID === entityID) ?? null
  );

  /**
   * @description returns how many of the given entities are selected
   * @param {string[]} entityIDs
   * @returns {"empty" | "partial" | "complete"} "empty" when the list is empty or nothing is selected
   */
  getSelectionStatus = computedFn((entityIDs: string[]): "empty" | "partial" | "complete" => {
    const totalSelected = entityIDs.filter((id) => this.getIsEntitySelected(id)).length;
    if (totalSelected === 0) return "empty";
    return totalSelected === entityIDs.length ? "complete" : "partial";
  });

  // entity actions
  /**
   * @description add or remove entities
   * @param {TEntityDetails} entityDetails
   * @param {"add" | "remove"} operation
   */
  updateSelectedEntityDetails = (entityDetails: TEntityDetails, operation: "add" | "remove") => {
    if (operation === "add") {
      runInAction(() => {
        if (this.getIsEntitySelected(entityDetails.entityID)) {
          remove(this.selectedEntityDetails, (en) => en.entityID === entityDetails.entityID);
        }
        this.selectedEntityDetails.push(entityDetails);
        this.updateLastSelectedEntityDetails(entityDetails);
      });
    } else {
      let currentSelection = [...this.selectedEntityDetails];
      currentSelection = currentSelection.filter((en) => en.entityID !== entityDetails.entityID);
      runInAction(() => {
        remove(this.selectedEntityDetails, (en) => en.entityID === entityDetails.entityID);
        this.updateLastSelectedEntityDetails(currentSelection[currentSelection.length - 1] ?? null);
      });
    }
  };

  /**
   * @description add or remove multiple entities
   * @param {TEntityDetails[]} entitiesList
   * @param {"add" | "remove"} operation
   */
  bulkUpdateSelectedEntityDetails = (entitiesList: TEntityDetails[], operation: "add" | "remove") => {
    if (operation === "add") {
      runInAction(() => {
        let newEntities: TEntityDetails[] = [];
        newEntities = differenceWith(this.selectedEntityDetails, entitiesList, isEqual);
        newEntities = newEntities.concat(entitiesList);
        this.selectedEntityDetails = newEntities;
        if (entitiesList.length > 0) this.updateLastSelectedEntityDetails(entitiesList[entitiesList.length - 1]);
      });
    } else {
      const newEntities = differenceWith(this.selectedEntityDetails, entitiesList, (obj1, obj2) =>
        isEqual(obj1.entityID, obj2.entityID)
      );
      runInAction(() => {
        this.selectedEntityDetails = newEntities;
      });
    }
  };

  /**
   * @description update last selected entity
   * @param {TEntityDetails} entityDetails
   */
  updateLastSelectedEntityDetails = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.lastSelectedEntityDetails = entityDetails;
    });
  };

  /**
   * @description update previous active entity
   * @param {TEntityDetails} entityDetails
   */
  updatePreviousActiveEntity = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.previousActiveEntity = entityDetails;
    });
  };

  /**
   * @description update next active entity
   * @param {TEntityDetails} entityDetails
   */
  updateNextActiveEntity = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.nextActiveEntity = entityDetails;
    });
  };

  /**
   * @description update active entity
   * @param {TEntityDetails} entityDetails
   */
  updateActiveEntityDetails = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.activeEntityDetails = entityDetails;
    });
  };

  /**
   * @description apply the same update to every selected entity and clear the selection. The selection is cleared
   * before the updates settle, as the updates are applied optimistically by the caller's update function.
   * @param {T} data
   * @param {(entityID: string, data: T) => Promise<unknown>} updateEntity
   * @returns {Promise<string[]>} ids of the entities whose update failed
   */
  applyBulkUpdate = async <T>(data: T, updateEntity: (entityID: string, data: T) => Promise<unknown>) => {
    const entityIDs = [...this.selectedEntityIds];
    this.clearSelection();
    const results = await Promise.allSettled(entityIDs.map(async (entityID) => updateEntity(entityID, data)));
    return entityIDs.filter((_, index) => results[index].status === "rejected");
  };

  /**
   * @description clear selection and reset all the observables
   */
  clearSelection = () => {
    runInAction(() => {
      this.selectedEntityDetails = [];
      this.lastSelectedEntityDetails = null;
      this.previousActiveEntity = null;
      this.nextActiveEntity = null;
      this.activeEntityDetails = null;
    });
  };
}
