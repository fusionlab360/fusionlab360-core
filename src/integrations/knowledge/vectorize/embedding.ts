export interface KnowledgeEmbeddingResult {

  vectors:
    number[][];
}


interface WorkersAIEmbeddingResponse {

  data:
    number[][];
}


const EMBEDDING_MODEL =
  "@cf/baai/bge-m3";


const EMBEDDING_DIMENSIONS =
  1024;


export async function createKnowledgeEmbeddings(
  ai:
    Ai,

  texts:
    string[],
): Promise<
  KnowledgeEmbeddingResult
> {

  if (
    texts.length ===
    0
  ) {

    return {
      vectors: [],
    };
  }


  const response =
    await ai.run(
      EMBEDDING_MODEL,

      {
        text:
          texts,
      },
    ) as WorkersAIEmbeddingResponse;


  if (
    !Array.isArray(
      response.data,
    )
  ) {

    throw new Error(
      "Workers AI embedding response did not contain a data array.",
    );
  }


  if (
    response.data.length !==
    texts.length
  ) {

    throw new Error(
      `Workers AI returned ${response.data.length} embeddings for ${texts.length} texts.`,
    );
  }


  for (
    const vector of
      response.data
  ) {

    if (
      !Array.isArray(
        vector,
      )
    ) {

      throw new Error(
        "Workers AI returned an invalid embedding vector.",
      );
    }


    if (
      vector.length !==
      EMBEDDING_DIMENSIONS
    ) {

      throw new Error(
        `Workers AI returned an embedding with dimension ${vector.length}; expected ${EMBEDDING_DIMENSIONS}.`,
      );
    }
  }


  return {

    vectors:
      response.data,
  };
}