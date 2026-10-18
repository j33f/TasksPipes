import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { LOCALES, csvSeparator, intlTag, localeOf, localize, localizePipeType, localizeTaskType, tr } from "./i18n.js";
import { pipeTypeById, taskTypeById } from "./pipeTypes.js";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as FastifyRequest;

describe("localeOf", () => {
  it("prefers the page's language, then the browser's, then the default", () => {
    expect(localeOf(req({ "x-locale": "fr", "accept-language": "en" }))).toBe("fr");
    expect(localeOf(req({ "accept-language": "de-DE,fr;q=0.8,en;q=0.5" }))).toBe("fr");
    expect(localeOf(req({ "accept-language": "de" }))).toBe("en");
    expect(localeOf(req({ "x-locale": "xx" }))).toBe("en");
    expect(localeOf(req({ "accept-language": "fr-CA;q=0.9" }))).toBe("fr");
  });
});

describe("tr", () => {
  it("translates messages and fills their placeholders", () => {
    expect(tr("en", "{label} is required", { label: "Title" })).toBe("Title is required");
    expect(tr("fr", "{label} is required", { label: "Title" })).toBe("Titre requis");
    expect(tr("fr", "{n} sub-tasks at most", { n: 200 })).toBe("200 sous-tâches au maximum");
  });

  it("translates catalog labels used as parameters into English", () => {
    expect(tr("en", "{field}: invalid date", { field: "Date de l'épreuve" })).toBe("Exam date: invalid date");
  });

  it("leaves unknown text and missing placeholders alone", () => {
    expect(tr("fr", "Something new")).toBe("Something new");
    expect(tr("en", "Hello {name},", {})).toBe("Hello {name},");
  });
});

describe("catalog localisation", () => {
  it("translates the French catalog into English and keeps it in French", () => {
    expect(localize("en", "Tâches générales")).toBe("General tasks");
    expect(localize("fr", "Tâches générales")).toBe("Tâches générales");
    expect(localize("fr", "Custom models")).toBe("Modèles personnalisés");
  });

  it("translates columns and keeps option values with translated labels", () => {
    expect(localizePipeType("en", pipeTypeById("general")!).columns.map((c) => c.label)).toContain("Ready to start");
    const f = localizeTaskType("en", taskTypeById("accompagnement_psh")!).fields.find((x) => x.id === "rqth")!;
    expect(f.options).toEqual(["Oui", "Non"]);
    expect(f.optionLabels).toEqual(["Yes", "No"]);
  });
});

describe("languages", () => {
  it("are the files of locales/, English first", () => {
    expect(LOCALES[0]).toBe("en");
    expect(LOCALES).toEqual(expect.arrayContaining(["fr", "es"]));
    expect(localeOf(req({ "accept-language": "es-ES,es;q=0.9" }))).toBe("es");
  });

  it("translate messages and the catalog, with their own formats", () => {
    expect(tr("es", "{label} is required", { label: "Title" })).toBe("Título: obligatorio");
    expect(localize("es", "Tâches générales")).toBe("Tareas generales");
    expect(intlTag("es")).toBe("es-ES");
    expect(csvSeparator("es")).toBe(";");
    expect(csvSeparator("en")).toBe(",");
  });
});
