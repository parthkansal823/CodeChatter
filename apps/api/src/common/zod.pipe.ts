import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/** `@Body(new ZodPipe(Schema))` parses the input and returns the typed value. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      message: "Validation failed",
      errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
}
