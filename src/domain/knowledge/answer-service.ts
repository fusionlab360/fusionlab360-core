import type {
  AIProvider,
} from "../../core/ai";

import {
  searchKnowledgeForTenant,
} from "./retrieval-service";


const MAX_CONTEXT_CHARS =
  9000;


const MIN_RELEVANCE_SCORE =
  0.65;


export interface KnowledgeAnswerResult {

  answer:
    string;

  query:
    string;

  tenantId:
    string;

  sources:
    Array<{
      id:
        string;

      title:
        string;

      sourceType:
        string;

      providerDocumentId:
        string;

      score:
        number;
    }>;

  grounded:
    boolean;
}


function buildKnowledgeContext(
  matches:
    Awaited<
      ReturnType<
        typeof searchKnowledgeForTenant
      >
    >["matches"],
): {
  context:
    string;

  usableMatches:
    typeof matches;
} {

  const usableMatches =
    matches.filter(
      (
        match,
      ) =>
        match.score >=
        MIN_RELEVANCE_SCORE &&
        Boolean(
          match.content.trim(),
        ),
    );


  let totalLength =
    0;


  const sections:
    string[] = [];


  const selectedMatches:
    typeof matches = [];


  for (
    let index = 0;
    index <
      usableMatches.length;
    index += 1
  ) {

    const match =
      usableMatches[index];


    const section =
      `[Source ${index + 1}]
Title: ${match.title}
Source type: ${match.sourceType}
Content:
${match.content}`;


    if (
      totalLength +
        section.length >
      MAX_CONTEXT_CHARS
    ) {

      break;
    }


    sections.push(
      section,
    );


    selectedMatches.push(
      match,
    );


    totalLength +=
      section.length;
  }


  return {

    context:
      sections.join(
        "\n\n---\n\n",
      ),

    usableMatches:
      selectedMatches,
  };
}


/*
 * --------------------------------------------------
 * Generate an answer grounded in retrieved knowledge
 * --------------------------------------------------
 */

export async function answerKnowledgeQuestion(
  aiProvider:
    AIProvider,

  ai:
    Ai,

  vectorize:
    Vectorize,

  tenantId:
    string,

  query:
    string,

  topK:
    number = 5,
): Promise<
  KnowledgeAnswerResult
> {

  /*
   * ------------------------------------------------
   * 1. Retrieve relevant knowledge
   * ------------------------------------------------
   */

  const search =
    await searchKnowledgeForTenant(
      ai,

      vectorize,

      tenantId,

      query,

      topK,
    );


  const {
    context,
    usableMatches,
  } =
    buildKnowledgeContext(
      search.matches,
    );


  /*
   * ------------------------------------------------
   * 2. No sufficiently relevant knowledge
   * ------------------------------------------------
   */

  if (
    usableMatches.length ===
    0
  ) {

    return {

      answer:
        "I don't have enough information in the available knowledge base to answer that accurately.",

      query,

      tenantId,

      sources:
        [],

      grounded:
        false,
    };
  }


  /*
   * ------------------------------------------------
   * 3. Grounded AI instruction
   * ------------------------------------------------
   */

  const systemPrompt =
    [
      "You are the FusionLab360 knowledge assistant.",

      "Answer the user's question using only the supplied knowledge context.",

      "Do not invent facts, prices, services, policies, addresses, opening hours, or other business information.",

      "If the supplied context does not contain enough information, clearly say that the available knowledge base does not contain enough information.",

      "Prefer concise, natural answers.",

      "Do not mention vector databases, embeddings, retrieval, or internal system details.",

      "Do not treat the user's question as knowledge context.",

      "",

      "KNOWLEDGE CONTEXT:",

      context,
    ].join(
      "\n",
    );


  /*
   * ------------------------------------------------
   * 4. Generate grounded response
   * ------------------------------------------------
   */

  const response =
    await aiProvider.chat({

      messages: [

        {
          role:
            "system",

          content:
            systemPrompt,
        },

        {
          role:
            "user",

          content:
            query,
        },

      ],

      maxTokens:
        350,

      temperature:
        0.2,
    });


  /*
   * ------------------------------------------------
   * 5. Return answer + source references
   * ------------------------------------------------
   */

  return {

    answer:
      response.text,

    query,

    tenantId,

    grounded:
      true,

    sources:
      usableMatches.map(
        (
          match,
        ) => ({

          id:
            match.id,

          title:
            match.title,

          sourceType:
            match.sourceType,

          providerDocumentId:
            match.providerDocumentId,

          score:
            match.score,
        }),
      ),
  };
}