import {
  ghlFetchAuthenticated,
} from "../client";

import {
  GHL,
} from "../config";

import type {
  GHLOpportunity,
} from "../types";

import type {
  RequestContext,
} from "../../../../context";


export function updateOpportunity(
  context:
    RequestContext,

  opportunityId:
    string,

  opportunity:
    Partial<GHLOpportunity>,
) {

  if (
    !opportunityId.trim()
  ) {

    throw new Error(
      "Opportunity ID is required.",
    );
  }


  return ghlFetchAuthenticated<GHLOpportunity>(
    context,

    `${GHL.ENDPOINTS.OPPORTUNITIES}/${encodeURIComponent(
      opportunityId,
    )}`,

    {
      method:
        "PUT",

      body:
        JSON.stringify(
          opportunity,
        ),
    },
  );
}


/*
 * --------------------------------------------------
 * Move Opportunity Stage
 * --------------------------------------------------
 *
 * Only the pipeline stage is changed.
 * No reservation rich-data fields are rebuilt here.
 */

export function moveOpportunity(
  context:
    RequestContext,

  opportunityId:
    string,

  pipelineStageId:
    string,
) {

  if (
    !pipelineStageId.trim()
  ) {

    throw new Error(
      "Pipeline stage ID is required.",
    );
  }


  return updateOpportunity(
    context,

    opportunityId,

    {
      pipelineStageId,

    } satisfies Partial<GHLOpportunity>,
  );
}