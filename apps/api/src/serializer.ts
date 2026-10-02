import type { FastifySerializerCompiler } from "fastify/types/schema";
import { ResponseSerializationError } from "fastify-type-provider-zod";
import type { z } from "zod";

/**
 * App-wide response serializer. fastify-type-provider-zod's serializer *encodes* responses, which fails on the
 * domain's one-way transforms (MoneySchema normalises decimals with a transform: "Encountered unidirectional
 * transform during encode"). Presenter output is already in the DTO's output form, so it is validated by parsing
 * (the decimal normalisation is idempotent) and the parsed value is serialized: unknown fields are still stripped
 * and invalid shapes are still a 500.
 */
export const parseSerializerCompiler: FastifySerializerCompiler<z.ZodType> = ({ schema, method, url }) => (data) => {
  const result = schema.safeParse(data);
  if (!result.success) throw new ResponseSerializationError(method, url, { cause: result.error });
  return JSON.stringify(result.data);
};
