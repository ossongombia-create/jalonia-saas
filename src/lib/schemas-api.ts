// Corps des requêtes de l'éditeur (API JSON). Le contenu lui-même est contrôlé par le service des documents.
import { z } from "zod";

export const schemaEnregistrement = z.object({
  /** Organisation dans laquelle l'éditeur a ouvert le document (voir organisationChangee). */
  organisationId: z.uuid(),
  /** Version sur laquelle la personne a travaillé. */
  version: z.number().int().min(0),
  /** Garder sa version malgré un conflit (choix explicite). */
  forcer: z.boolean().optional(),
  contenu: z.unknown(),
});

export const schemaCreation = z.object({
  organisationId: z.uuid(),
  contenu: z.unknown(),
});
